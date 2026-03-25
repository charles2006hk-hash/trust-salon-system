"use client";

import { useState, useEffect } from 'react';
import { signInWithEmailAndPassword, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import { toast, Toaster } from 'react-hot-toast';
import Link from 'next/link';

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [pageChecking, setPageChecking] = useState(true);
  const router = useRouter();

  // 🟢 智慧檢查：如果他已經登入了，直接把他送進大後台，不用再登入一次
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const docRef = doc(db, 'users', user.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists() && docSnap.data().role !== 'member') {
            router.replace('/admin'); // 是員工，直接進去
            return;
          }
        } catch (e) { console.error(e); }
      }
      setPageChecking(false);
    });
    return () => unsubscribe();
  }, [router]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) return toast.error("請輸入完整登入資訊");

    setLoading(true);
    const toastId = toast.loading("正在驗證安全憑證...");

    try {
      // 🟢 執行 Email 與密碼登入
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      // 登入成功後，檢查他的 Firestore 權限
      const docRef = doc(db, 'users', userCredential.user.uid);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const role = docSnap.data().role;
        // 如果是一般客人不小心跑到這裡登入
        if (!role || role === 'member') {
          toast.error("權限不足：此入口僅限內部員工使用", { id: toastId });
          await auth.signOut();
          setLoading(false);
          return;
        }
        
        toast.success("驗證成功！正在啟動系統...", { id: toastId });
        router.push('/admin'); // 完美跳轉至後台
      } else {
        throw new Error("找不到對應的員工檔案");
      }
    } catch (error) {
      console.error(error);
      toast.error("登入失敗：帳號或密碼錯誤", { id: toastId });
      setLoading(false);
    }
  };

  if (pageChecking) return <div className="min-h-screen flex items-center justify-center bg-[#080808] text-[#D4AF37] tracking-widest text-xs uppercase">Initializing OS...</div>;

  return (
    <div className="bg-[#080808] min-h-screen flex items-center justify-center p-6 font-sans selection:bg-[#D4AF37] selection:text-black relative overflow-hidden">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      <Toaster position="top-right" />
      
      {/* 背景裝飾光暈 */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-[#D4AF37] opacity-5 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-white opacity-5 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="w-full max-w-md relative z-10">
        
        {/* 🟢 Logo 與系統標題 */}
        <div className="text-center mb-10 flex flex-col items-center animate-fade-in-up">
           {/* 如果你有 Logo 圖片，可以把下面這行 h1 換成 img 標籤 */}
           <h1 className="text-4xl font-black tracking-widest text-white italic mb-2">TRUST<span className="text-[#D4AF37] not-italic">.</span> OS</h1>
           <p className="text-[10px] text-[#D4AF37] uppercase tracking-[0.5em] font-bold border border-[#D4AF37]/30 px-4 py-1.5 rounded-full bg-[#D4AF37]/10 mt-3">
              Staff Portal
           </p>
        </div>

        <div className="bg-[#121212] p-10 rounded-[40px] border border-white/5 shadow-2xl relative animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          <form onSubmit={handleLogin} className="space-y-6">
            
            <div>
              <h2 className="text-2xl font-bold text-white mb-2 tracking-wide">System Login</h2>
              <p className="text-xs text-gray-500 leading-relaxed">請輸入您的內部員工 Email 與密碼以存取大後台與收銀系統。</p>
            </div>

            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">Email Address</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <i className="fa-solid fa-envelope text-gray-500 text-sm"></i>
                  </div>
                  <input 
                    type="email" required 
                    value={email} onChange={e => setEmail(e.target.value)} 
                    className="w-full bg-black border border-white/10 p-4 pl-12 rounded-2xl text-white outline-none focus:border-[#D4AF37] transition-colors text-sm" 
                    placeholder="staff@trustsalon.com" 
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">Password</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <i className="fa-solid fa-lock text-gray-500 text-sm"></i>
                  </div>
                  <input 
                    type="password" required 
                    value={password} onChange={e => setPassword(e.target.value)} 
                    className="w-full bg-black border border-white/10 p-4 pl-12 rounded-2xl text-white outline-none focus:border-[#D4AF37] transition-colors text-sm font-mono tracking-widest" 
                    placeholder="••••••••" 
                  />
                </div>
              </div>
            </div>

            <button type="submit" disabled={loading} className="w-full bg-white text-black font-black py-4 rounded-2xl uppercase tracking-widest text-xs hover:bg-[#D4AF37] transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_20px_rgba(212,175,55,0.3)] disabled:opacity-50 mt-2">
              {loading ? "Authenticating..." : "登入系統"}
            </button>
          </form>
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
