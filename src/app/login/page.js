"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Toaster, toast } from 'react-hot-toast';

export default function LoginPage() {
  const router = useRouter();
  
  // 流程狀態：'phone' (輸入電話) -> 'otp' (輸入驗證碼) -> 'register' (新客填寫資料)
  const [step, setStep] = useState('phone'); 
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);

  // 登入資料
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [confirmationResult, setConfirmationResult] = useState(null);

  // 註冊資料 (新客專用)
  const [formData, setFormData] = useState({
    name: '',
    birthMonth: '',
    gender: '',
    interest: ''
  });

  // 🟢 智慧路由：檢查登入狀態與身分
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // 如果正在填寫註冊表單，不要打斷他
      if (user && step !== 'register') {
        try {
          const docRef = doc(db, 'users', user.uid);
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            // 是老客戶或員工
            const role = docSnap.data().role;
            if (['admin', 'manager', 'staff', 'reception'].includes(role)) {
              router.push('/admin'); // 內部人員去大後台
            } else {
              router.push('/dashboard'); // 一般客人去前台
            }
          } else {
            // 是第一次登入的新客，Firestore 還沒有他的資料 -> 進入註冊畫面
            setStep('register');
            setPageLoading(false);
          }
        } catch (error) {
          console.error("權限讀取失敗", error);
          setPageLoading(false);
        }
      } else {
        setPageLoading(false);
      }
    });
    return () => unsubscribe();
  }, [router, step]);

  // 初始化 Recaptcha (防機器人)
  const setupRecaptcha = () => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
      });
    }
  };

  // 步驟 1：發送 SMS 驗證碼
  const handleSendOtp = async (e) => {
    e.preventDefault();
    if (!phoneNumber) return toast.error("請輸入手機號碼");
    
    // 確保號碼帶有區碼 (預設加香港 +852)
    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+852${phoneNumber}`;
    
    setLoading(true);
    const toastId = toast.loading("正在發送 SMS 驗證碼...");
    try {
      setupRecaptcha();
      const appVerifier = window.recaptchaVerifier;
      const result = await signInWithPhoneNumber(auth, formattedPhone, appVerifier);
      setConfirmationResult(result);
      setStep('otp');
      toast.success("驗證碼已發送！", { id: toastId });
    } catch (error) {
      console.error(error);
      toast.error("發送失敗，請確認號碼格式或稍後再試", { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  // 步驟 2：驗證 OTP (由 onAuthStateChanged 接手後續導航)
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otp || !confirmationResult) return;
    
    setLoading(true);
    const toastId = toast.loading("驗證中...");
    try {
      await confirmationResult.confirm(otp);
      toast.success("手機驗證成功！", { id: toastId });
      // 驗證成功後，上面的 useEffect 會自動觸發，去檢查他是老客還是新客
    } catch (error) {
      toast.error("驗證碼錯誤", { id: toastId });
      setLoading(false);
    }
  };

  // 步驟 3：新客完成自助註冊
  const handleRegister = async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return toast.error("系統錯誤：遺失登入狀態");
    if (!formData.name || !formData.birthMonth || !formData.gender || !formData.interest) {
      return toast.error("請填寫完整資料以領取迎新獎勵");
    }

    setLoading(true);
    const toastId = toast.loading("正在為您建立專屬檔案...");
    try {
      await setDoc(doc(db, 'users', user.uid), {
        phoneNumber: user.phoneNumber,
        name: formData.name,
        birthMonth: formData.birthMonth,
        gender: formData.gender,
        interest: formData.interest,
        tDollarBalance: 100, // 🟢 新客註冊自動派發 $100 迎新
        points: 0,
        role: 'member',
        createdAt: new Date().toISOString()
      });
      toast.success("註冊成功！已將 $100 迎新存入您的帳戶", { id: toastId });
      router.push('/dashboard');
    } catch (error) {
      toast.error("註冊失敗，請重試", { id: toastId });
      setLoading(false);
    }
  };

  if (pageLoading) return <div className="min-h-screen flex items-center justify-center bg-[#080808] text-[#D4AF37] tracking-widest text-xs uppercase">Connecting...</div>;

  return (
    <div className="bg-[#080808] min-h-screen flex items-center justify-center p-6 font-sans selection:bg-[#D4AF37] selection:text-black">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      <Toaster position="top-right" />
      <div id="recaptcha-container"></div>
      
      <div className="w-full max-w-md">
        
        {/* Logo 區塊 */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-black tracking-widest text-white italic mb-2">TRUST<span className="text-[#D4AF37] not-italic">.</span></h1>
          <p className="text-[10px] text-gray-500 uppercase tracking-[0.4em] font-bold">Member Portal</p>
        </div>

        <div className="bg-[#121212] p-10 rounded-[40px] border border-white/5 shadow-2xl relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-32 h-32 bg-[#D4AF37] opacity-10 rounded-full blur-3xl"></div>
          
          {/* 🟢 Step 1: 輸入手機號碼 */}
          {step === 'phone' && (
            <form onSubmit={handleSendOtp} className="space-y-6 relative z-10 animate-fade-in">
              <div>
                <h2 className="text-xl font-bold text-white mb-2 tracking-widest">Welcome</h2>
                <p className="text-xs text-gray-500 leading-relaxed">請輸入您的手機號碼。<br/>新客戶註冊即享 <span className="text-[#D4AF37] font-bold">$100 迎新 T-Dollar</span>。</p>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">Phone Number</label>
                <div className="flex gap-2">
                  <div className="bg-black border border-white/10 p-4 rounded-2xl text-white text-sm font-mono flex items-center justify-center w-20 shrink-0">+852</div>
                  <input type="tel" required value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} className="w-full bg-black border border-white/10 p-4 rounded-2xl text-white outline-none focus:border-[#D4AF37] transition-colors font-mono tracking-widest" placeholder="98765432" />
                </div>
              </div>
              <button type="submit" disabled={loading} className="w-full bg-white text-black font-black py-4 rounded-2xl uppercase tracking-widest text-[10px] hover:bg-[#D4AF37] transition-all shadow-xl disabled:opacity-50">
                {loading ? "處理中..." : "獲取 SMS 驗證碼"}
              </button>
            </form>
          )}

          {/* 🟢 Step 2: 輸入 OTP 驗證碼 */}
          {step === 'otp' && (
            <form onSubmit={handleVerifyOtp} className="space-y-6 relative z-10 animate-fade-in">
              <div>
                <h2 className="text-xl font-bold text-white mb-2 tracking-widest">Verify</h2>
                <p className="text-xs text-gray-500 leading-relaxed">我們已發送 6 位數驗證碼至 <br/><span className="text-[#D4AF37] font-mono tracking-widest">{phoneNumber}</span></p>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">SMS 驗證碼</label>
                <input type="text" required value={otp} onChange={e => setOtp(e.target.value)} className="w-full bg-black border border-white/10 p-4 rounded-2xl text-center text-white outline-none focus:border-[#D4AF37] transition-colors font-mono tracking-[1em] text-xl" placeholder="••••••" maxLength={6} />
              </div>
              <div className="flex gap-4">
                <button type="button" onClick={() => setStep('phone')} className="px-6 bg-white/5 text-gray-400 font-bold py-4 rounded-2xl uppercase tracking-widest text-[10px] hover:text-white transition-all">返回</button>
                <button type="submit" disabled={loading} className="flex-1 bg-[#D4AF37] text-black font-black py-4 rounded-2xl uppercase tracking-widest text-[10px] hover:scale-105 transition-all shadow-xl disabled:opacity-50">
                  {loading ? "驗證中..." : "登入 / 註冊"}
                </button>
              </div>
            </form>
          )}

          {/* 🟢 Step 3: 新客自助註冊表單 */}
          {step === 'register' && (
            <form onSubmit={handleRegister} className="space-y-5 relative z-10 animate-fade-in">
              <div className="border-b border-white/10 pb-4 mb-2">
                <h2 className="text-xl font-bold text-[#D4AF37] mb-1 tracking-widest italic">Create Profile</h2>
                <p className="text-[10px] text-gray-400 uppercase tracking-widest">完成檔案以領取 $100 迎新獎勵</p>
              </div>
              
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">1. 怎麼稱呼您？(Name)</label>
                <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-black border border-white/10 p-3.5 rounded-xl text-white outline-none focus:border-[#D4AF37] transition-colors text-sm" placeholder="例如：陳大文 / Ivan" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">2. 性別 (Gender)</label>
                  <select required value={formData.gender} onChange={e => setFormData({...formData, gender: e.target.value})} className="w-full bg-black border border-white/10 p-3.5 rounded-xl text-white outline-none focus:border-[#D4AF37] text-sm appearance-none">
                    <option value="" disabled>請選擇...</option>
                    <option value="male">男士</option>
                    <option value="female">女士</option>
                    <option value="secret">不願透露</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">3. 出生月份 (Month)</label>
                  <select required value={formData.birthMonth} onChange={e => setFormData({...formData, birthMonth: e.target.value})} className="w-full bg-black border border-white/10 p-3.5 rounded-xl text-white outline-none focus:border-[#D4AF37] text-sm appearance-none">
                    <option value="" disabled>生日月份</option>
                    {Array.from({length: 12}, (_, i) => i + 1).map(m => (
                      <option key={m} value={m}>{m} 月</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">4. 最想體驗的服務？(Interest)</label>
                <select required value={formData.interest} onChange={e => setFormData({...formData, interest: e.target.value})} className="w-full bg-black border border-white/10 p-3.5 rounded-xl text-white outline-none focus:border-[#D4AF37] text-sm appearance-none">
                  <option value="" disabled>請選擇有興趣的項目...</option>
                  <option value="日系剪裁">✂️ 日系剪裁</option>
                  <option value="透明感染髮">🎨 透明感染髮</option>
                  <option value="電燙捲髮">✨ 電燙捲髮</option>
                  <option value="結構式護髮">💧 結構式護髮</option>
                  <option value="頭皮深層護理">🌿 頭皮深層護理</option>
                </select>
              </div>

              <button type="submit" disabled={loading} className="w-full bg-[#D4AF37] text-black font-black py-4 rounded-xl uppercase tracking-widest text-[10px] hover:scale-105 transition-all mt-4 shadow-[0_0_20px_rgba(212,175,55,0.2)] disabled:opacity-50">
                {loading ? "處理中..." : "完成註冊並進入"}
              </button>
            </form>
          )}

        </div>
        
        <div className="text-center mt-8">
           <a href="#" className="text-[10px] text-gray-600 uppercase tracking-[0.3em] hover:text-[#D4AF37] transition-colors border-b border-white/5 pb-1">內部員工通道 (Staff Only)</a>
        </div>
      </div>

      <style jsx>{`
        .animate-fade-in { animation: fadeIn 0.4s ease-in-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
