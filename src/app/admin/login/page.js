"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { Toaster, toast } from 'react-hot-toast';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    if (!email || !password) return toast.error("請輸入完整的帳號密碼");

    setLoading(true);
    const toastId = toast.loading("正在驗證內部權限...");

    try {
      // 1. 使用 Email/Password 登入
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // 2. 去資料庫檢查他是不是真的員工/老闆
      const docRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const role = docSnap.data().role;
        
        if (role === 'admin' || role === 'staff') {
          toast.success("登入成功！歡迎回來", { id: toastId });
          router.push('/admin'); // 驗證成功，送進大後台
        } else {
          // 如果他只是用 Email 註冊的普通客人，踢出去
          await signOut(auth);
          toast.error("權限不足：您沒有訪問 TRUST OS 的權限", { id: toastId });
        }
      } else {
        await signOut(auth);
        toast.error("系統查無此內部人員資料", { id: toastId });
      }
    } catch (error) {
      console.error(error);
      toast.error("登入失敗：帳號或密碼錯誤", { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#080808] min-h-screen flex items-center justify-center p-6 font-sans selection:bg-[#D4AF37] selection:text-black">
      <Toaster position="top-right" />
      
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-black tracking-widest text-white italic mb-2">TRUST <span className="text-[#D4AF37]">OS</span></h1>
          <p className="text-[10px] text-gray-500 uppercase tracking-[0.4em] font-bold">Staff Portal • 內部管理系統</p>
        </div>

        <div className="bg-[#121212] p-10 rounded-[40px] border border-white/5 shadow-2xl relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-32 h-32 bg-[#D4AF37] opacity-10 rounded-full blur-3xl"></div>
          
          <form onSubmit={handleAdminLogin} className="space-y-6 relative z-10">
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">Staff Email</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600"><i className="fa-solid fa-envelope"></i></span>
                <input 
                  type="email" required
                  value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full bg-black border border-white/10 p-4 pl-12 rounded-2xl text-white outline-none focus:border-[#D4AF37] transition-colors"
                  placeholder="admin@trustsalon.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">Password</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-600"><i className="fa-solid fa-lock"></i></span>
                <input 
                  type="password" required
                  value={password} onChange={e => setPassword(e.target.value)}
                  className="w-full bg-black border border-white/10 p-4 pl-12 rounded-2xl text-white outline-none focus:border-[#D4AF37] transition-colors"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button type="submit" disabled={loading} className="w-full bg-white text-black font-black py-4 rounded-2xl uppercase tracking-widest text-[10px] hover:bg-[#D4AF37] transition-all mt-4 disabled:opacity-50 shadow-xl shadow-white/5">
              {loading ? "Verifying..." : "System Login"}
            </button>
          </form>
        </div>

        <p className="text-center text-gray-600 text-[10px] mt-8 tracking-widest uppercase">
          <i className="fa-solid fa-shield-halved mr-1 text-[#D4AF37]"></i> Authorized Personnel Only
        </p>
      </div>
    </div>
  );
}
