"use client";

import { useState, useEffect } from 'react';
import { signInWithEmailAndPassword, onAuthStateChanged, updatePassword } from 'firebase/auth'; // 🟢 補上 updatePassword
import { doc, getDoc, updateDoc } from 'firebase/firestore'; // 🟢 補上 updateDoc
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { toast, Toaster } from 'react-hot-toast';
import Link from 'next/link';

export default function AdminLoginPage() {
  // 🟢 將原本的 email 狀態改為 phone 狀態
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [pageChecking, setPageChecking] = useState(true);
  const router = useRouter();

  // 🟢 密碼眼睛控制狀態
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // 🟢 首次登入智能攔截與強制改密碼狀態
  const [isForcingChange, setIsForcingChange] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pendingUserCredential, setPendingUserCredential] = useState(null);

  // 🟢 系統母信箱設定
  const MASTER_EMAIL = "trustsalon.taipo@gmail.com";

  // 智慧檢查：如果他已經登入了，直接把他送進大後台
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user && !isForcingChange) {
        try {
          const docRef = doc(db, 'users', user.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists() && docSnap.data().role !== 'member') {
            router.replace('/admin'); 
            return;
          }
        } catch (e) { console.error(e); }
      }
      setPageChecking(false);
    });
    return () => unsubscribe();
  }, [router, isForcingChange]);

  // 🟢 步驟一：處理常規電話密碼登入提交
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!phone || !password) return toast.error("請輸入完整登入資訊");

    setLoading(true);
    const toastId = toast.loading("正在驗證安全憑證...");

    try {
      // 1. 萃取純數字，自動組合影子信箱
      const cleanPhone = phone.replace(/[^0-9]/g, '');
      const cleanPassword = password.trim();
      
      if (!cleanPhone || cleanPhone.length < 8) {
        setLoading(false);
        return toast.error("請輸入有效的電話號碼", { id: toastId });
      }

      const loginEmail = MASTER_EMAIL.replace('@', `+${cleanPhone}@`);

      // 2. 執行影子信箱與密碼驗證
      const userCredential = await signInWithEmailAndPassword(auth, loginEmail, cleanPassword);
      
      // 3. 檢查 Firestore 權限
      const docRef = doc(db, 'users', userCredential.user.uid);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const userData = docSnap.data();
        
        // 防呆攔截客人跑錯入口
        if (!userData.role || userData.role === 'member') {
          toast.error("權限不足：此入口僅限內部員工使用", { id: toastId });
          await auth.signOut();
          setLoading(false);
          return;
        }
        
        // 4. 智能攔截：如果是初始密碼 123456 且尚未被標記為 false，開啟強改密碼彈窗
        if (cleanPassword === '123456' && userData.isFirstLogin !== false) {
          setPendingUserCredential(userCredential);
          setIsForcingChange(true);
          toast.dismiss(toastId);
          setLoading(false);
          return;
        }

        toast.success("驗證成功！正在啟動系統...", { id: toastId });
        router.push('/admin'); 
      } else {
        throw new Error("找不到對應的員工檔案");
      }
    } catch (error) {
      console.error(error);
      toast.error("登入失敗：電話號碼或密碼錯誤", { id: toastId });
      setLoading(false);
    }
  };

  // 🟢 步驟二：處理員工在提示下修改新密碼
  const handleForceChangeSubmit = async (e) => {
    e.preventDefault();
    const cleanNewPassword = newPassword.trim();
    const cleanConfirmPassword = confirmPassword.trim();

    if (cleanNewPassword.length < 6) return toast.error('密碼長度必須至少為 6 個字元。');
    if (cleanNewPassword !== cleanConfirmPassword) return toast.error('兩次輸入的新密碼不一致。');
    if (cleanNewPassword === '123456') return toast.error('新密碼不能與初始預設密碼相同。');

    setLoading(true);
    const toastId = toast.loading("正在安全加密並更新您的個人密碼...");

    try {
      if (pendingUserCredential && pendingUserCredential.user) {
        // 更新 Firebase Auth 帳密
        await updatePassword(pendingUserCredential.user, cleanNewPassword);
        
        // 同步在 Firestore 資料庫關閉首次登入提醒標籤
        await updateDoc(doc(db, "users", pendingUserCredential.user.uid), {
          isFirstLogin: false
        });

        toast.success('密碼更新成功！已自動為您開通大後台權限。', { id: toastId });
        router.push('/admin');
      }
    } catch (err) {
      console.error(err);
      toast.error('密碼更新失敗，請重新嘗試或聯繫系統管理員。', { id: toastId });
      setLoading(false);
    }
  };

  // 🟢 步驟三：員工選擇「暫不修改」直接登入 (撕除標籤，第二次再也不會跳出)
  const handleSkipChange = async () => {
    setLoading(true);
    const toastId = toast.loading("正在加載系統資料...");
    try {
      if (pendingUserCredential && pendingUserCredential.user) {
        await updateDoc(doc(db, "users", pendingUserCredential.user.uid), {
          isFirstLogin: false
        });
        toast.success('已為您登入系統。', { id: toastId });
        router.push('/admin');
      }
    } catch (err) {
      router.push('/admin');
    }
  };

  if (pageChecking) return <div className="min-h-screen flex items-center justify-center bg-[#080808] text-[#D4AF37] tracking-widest text-xs uppercase">Initializing OS...</div>;

  return (
    <div className="bg-[#080808] min-h-screen flex items-center justify-center p-6 font-sans selection:bg-[#D4AF37] selection:text-black relative overflow-hidden">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      <Toaster position="top-right" />
      
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-[#D4AF37] opacity-5 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-white opacity-5 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="w-full max-w-md relative z-10">
        
        <div className="text-center mb-10 flex flex-col items-center animate-fade-in-up">
           <h1 className="text-4xl font-black tracking-widest text-white italic mb-2">TRUST<span className="text-[#D4AF37] not-italic">.</span> OS</h1>
           <p className="text-[10px] text-[#D4AF37] uppercase tracking-[0.5em] font-bold border border-[#D4AF37]/30 px-4 py-1.5 rounded-full bg-[#D4AF37]/10 mt-3">
              Staff Portal
           </p>
        </div>

        <div className="bg-[#121212] p-10 rounded-[40px] border border-white/5 shadow-2xl relative animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          
          {/* 🟢 條件渲染：常規登入介面 VS 強制改密碼引導視窗 */}
          {!isForcingChange ? (
            <form onSubmit={handleLogin} className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-white mb-2 tracking-wide">System Login</h2>
                <p className="text-xs text-gray-500 leading-relaxed">請輸入您的內部員工電話與密碼以存取大後台與收銀系統。</p>
              </div>

              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">Phone Number (員工電話)</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <i className="fa-solid fa-phone text-gray-500 text-sm"></i>
                    </div>
                    <input 
                      type="tel" required 
                      value={phone} onChange={e => setPhone(e.target.value)} 
                      className="w-full bg-black border border-white/10 p-4 pl-12 rounded-2xl text-white outline-none focus:border-[#D4AF37] transition-colors text-sm font-mono tracking-widest" 
                      placeholder="98765432" 
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">Password (登入密碼)</label>
                  <div className="relative flex items-center">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <i className="fa-solid fa-lock text-gray-500 text-sm"></i>
                    </div>
                    <input 
                      type={showPassword ? "text" : "password"} required 
                      value={password} onChange={e => setPassword(e.target.value)} 
                      className="w-full bg-black border border-white/10 p-4 pl-12 pr-12 rounded-2xl text-white outline-none focus:border-[#D4AF37] transition-colors text-sm font-mono tracking-widest" 
                      placeholder="••••••••" 
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 text-gray-500 hover:text-white transition-colors">
                      {showPassword ? <i className="fa-solid fa-eye-slash text-sm"></i> : <i className="fa-solid fa-eye text-sm"></i>}
                    </button>
                  </div>
                </div>
              </div>

              <button type="submit" disabled={loading} className="w-full bg-white text-black font-black py-4 rounded-2xl uppercase tracking-widest text-xs hover:bg-[#D4AF37] transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_20px_rgba(212,175,55,0.3)] disabled:opacity-50 mt-2">
                {loading ? "Authenticating..." : "登入系統"}
              </button>
            </form>
          ) : (
            // 🟢 強制修改個人專屬密碼視窗 (沿用黑金尊爵風格與原汁原味提示邏輯)
            <form onSubmit={handleForceChangeSubmit} className="space-y-6">
              <div className="bg-[#D4AF37]/10 border border-[#D4AF37]/20 p-4 rounded-2xl text-[#D4AF37] text-xs font-bold leading-relaxed flex items-start gap-3">
                 <div className="mt-0.5"><i className="fa-solid fa-triangle-exclamation text-base"></i></div>
                 <p>系統偵測到您正在使用初始預設密碼。<br/>為保障您個人帳號資產與發佣安全，建議立即變更密碼。</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">設定全新個人密碼 (New Password)</label>
                  <div className="relative flex items-center">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <i className="fa-solid fa-key text-gray-500 text-sm"></i>
                    </div>
                    <input 
                      type={showNewPassword ? "text" : "password"} required minLength={6}
                      className="w-full bg-black border border-white/10 p-4 pl-12 pr-12 rounded-2xl text-white outline-none focus:border-[#D4AF37] text-sm" 
                      placeholder="輸入至少 6 位數新密碼" 
                      value={newPassword} onChange={e => setNewPassword(e.target.value)} 
                    />
                    <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="absolute right-4 text-gray-500 hover:text-white transition-colors">
                      {showNewPassword ? <i className="fa-solid fa-eye-slash text-sm"></i> : <i className="fa-solid fa-eye text-sm"></i>}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">確認新密碼 (Confirm Password)</label>
                  <div className="relative flex items-center">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <i className="fa-solid fa-lock text-gray-500 text-sm"></i>
                    </div>
                    <input 
                      type={showConfirmPassword ? "text" : "password"} required minLength={6}
                      className="w-full bg-black border border-white/10 p-4 pl-12 pr-12 rounded-2xl text-white outline-none focus:border-[#D4AF37] text-sm" 
                      placeholder="再次輸入新密碼" 
                      value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} 
                    />
                    <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-4 text-gray-500 hover:text-white transition-colors">
                      {showConfirmPassword ? <i className="fa-solid fa-eye-slash text-sm"></i> : <i className="fa-solid fa-eye text-sm"></i>}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                 <button type="button" onClick={handleSkipChange} disabled={loading} className="flex-1 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-400 hover:text-white py-4 rounded-2xl font-bold text-xs transition-colors">
                   暫不修改
                 </button>
                 <button type="submit" disabled={loading} className="flex-[2] bg-[#D4AF37] text-black font-black py-4 rounded-2xl text-xs flex items-center justify-center transition-all shadow-xl">
                    {loading ? "更新中..." : "確認修改並登入"}
                 </button>
              </div>
            </form>
          )}

        </div>
        
        {/* 返回客戶前台通道 */}
        <div className="text-center mt-8 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
           <Link href="/login" className="text-[10px] text-gray-600 uppercase tracking-[0.3em] hover:text-white transition-colors flex items-center justify-center gap-2">
              <i className="fa-solid fa-arrow-left"></i> 返回客戶專屬入口
           </Link>
        </div>
      </div>

      <style jsx>{`
        .animate-fade-in-up { animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both; }
        @keyframes fadeInUp { 
          from { opacity: 0; transform: translateY(20px); } 
          to { opacity: 1; transform: translateY(0); } 
        }
      `}</style>
    </div>
  );
}
