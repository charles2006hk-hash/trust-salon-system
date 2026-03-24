"use client";

import { useState } from 'react';
import { auth } from '@/lib/firebase';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link'; // 確保引入 Link

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // 初始化 Recaptcha
  const setupRecaptcha = () => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
      });
    }
  };

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setupRecaptcha();
    const formattedPhone = phone.startsWith('+') ? phone : `+852${phone}`;

    try {
      const appVerifier = window.recaptchaVerifier;
      const result = await signInWithPhoneNumber(auth, formattedPhone, appVerifier);
      setConfirmationResult(result);
      alert('驗證碼已發送至您的 WhatsApp / SMS');
    } catch (error) {
      console.error(error);
      alert('發送失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await confirmationResult.confirm(otp);
      router.push('/dashboard');
    } catch (error) {
      alert('驗證碼錯誤');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#080808] min-h-screen flex items-center justify-center p-8 font-sans relative selection:bg-[#D4AF37] selection:text-black">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />

      {/* 🟢 頂部返回導航 - 日韓極簡風格 */}
      <div className="absolute top-10 left-10">
        <Link href="/" className="group flex items-center gap-4">
          <div className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center group-hover:border-[#D4AF37] transition-all">
            <i className="fa-solid fa-chevron-left text-[10px] text-gray-500 group-hover:text-[#D4AF37]"></i>
          </div>
          <span className="text-[10px] font-black tracking-[0.4em] uppercase text-gray-500 group-hover:text-white transition-colors">
            Back to Home
          </span>
        </Link>
      </div>

      <div className="w-full max-w-sm">
        {/* Logo 區塊 */}
        <div className="text-center mb-16">
          <Link href="/" className="inline-block">
            <h1 className="text-3xl font-light tracking-[0.5em] text-white italic">
              TRUST<span className="text-[#D4AF37] not-italic">.</span>
            </h1>
          </Link>
          <div className="mt-6 inline-block px-4 py-1.5 bg-[#D4AF37]/5 border border-[#D4AF37]/20 rounded-full">
            <p className="text-[9px] text-[#D4AF37] font-bold tracking-[0.2em] uppercase">
              🎁 新註冊即送 $100 T-Dollar 迎新獎賞
            </p>
          </div>
        </div>

        <div className="bg-[#121212]/50 backdrop-blur-xl p-10 rounded-[40px] border border-white/5 shadow-2xl">
          {!confirmationResult ? (
            <form onSubmit={handleSendOtp} className="space-y-8">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-[0.3em] mb-4">Phone Number</label>
                <div className="relative">
                  <span className="absolute left-0 bottom-3 text-lg font-light text-gray-500">+852</span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                    className="w-full bg-transparent border-b border-white/10 pt-2 pb-3 pl-14 text-2xl font-light text-white outline-none focus:border-[#D4AF37] transition-all placeholder:text-gray-800"
                    placeholder="手機號碼"
                    maxLength="8"
                    required
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading || phone.length < 8}
                className="w-full bg-white text-black font-black py-5 rounded-2xl hover:bg-[#D4AF37] transition-all duration-500 disabled:opacity-20 text-sm tracking-widest uppercase"
              >
                {loading ? "Sending..." : "Send Verification"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-8">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-[0.3em] mb-4">OTP Code</label>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  className="w-full bg-transparent border-b border-white/10 py-3 text-3xl font-light text-center tracking-[0.5em] text-white outline-none focus:border-[#D4AF37] transition-all"
                  placeholder="000000"
                  maxLength="6"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading || otp.length < 6}
                className="w-full bg-[#D4AF37] text-black font-black py-5 rounded-2xl hover:bg-white transition-all duration-500 disabled:opacity-20 text-sm tracking-widest uppercase"
              >
                {loading ? "Verifying..." : "Verify & Enter"}
              </button>
              <button 
                type="button"
                onClick={() => setConfirmationResult(null)}
                className="w-full text-[10px] font-bold text-gray-600 hover:text-white transition-colors uppercase tracking-widest"
              >
                修改手機號碼
              </button>
            </form>
          )}
        </div>
        
        <p className="mt-12 text-center text-[8px] text-gray-700 tracking-[0.5em] uppercase">
          Secure Login via Firebase Auth
        </p>
      </div>

      <div id="recaptcha-container"></div>
    </div>
  );
}