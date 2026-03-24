"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

export default function HomePage() {
  const [promos, setPromos] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const today = new Date().toISOString().split('T')[0];
        
        // 抓取優惠 (過濾掉過期的)
        const promoSnap = await getDocs(collection(db, 'promos'));
        setPromos(promoSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.expiry >= today));

        // 抓取服務清單
        const serviceSnap = await getDocs(collection(db, 'services'));
        setServices(serviceSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (error) { 
        console.error(error); 
      } finally { 
        setLoading(false); 
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#080808] flex flex-col items-center justify-center text-[#D4AF37] space-y-4">
        <div className="w-12 h-12 border-t-2 border-[#D4AF37] rounded-full animate-spin"></div>
        <p className="text-[10px] tracking-[0.4em] uppercase">Loading Studio...</p>
      </div>
    );
  }

  return (
    <div className="bg-[#080808] min-h-screen font-sans text-gray-300 selection:bg-[#D4AF37] selection:text-black leading-relaxed tracking-wide">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />

      {/* 1. 導航列：日系透明感 */}
      <nav className="fixed w-full z-50 bg-[#080808]/80 backdrop-blur-2xl border-b border-white/5 transition-all">
        <div className="max-w-7xl mx-auto px-6 md:px-12 h-24 flex justify-between items-center">
          <div className="flex flex-col">
            <span className="text-2xl font-light tracking-[0.4em] text-white italic">TRUST<span className="text-[#D4AF37] not-italic">.</span></span>
            <span className="text-[7px] text-gray-500 tracking-[0.6em] uppercase mt-1">Design & Tech</span>
          </div>
          <div className="hidden md:flex gap-12 text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">
            <a href="#concept" className="hover:text-[#D4AF37] transition-colors">Concept</a>
            <a href="#promos" className="hover:text-[#D4AF37] transition-colors">Promos</a>
            <a href="#services" className="hover:text-[#D4AF37] transition-colors">Menu</a>
            <a href="#locations" className="hover:text-[#D4AF37] transition-colors">Studio</a>
          </div>
          <Link href="/login" className="text-[10px] font-black tracking-widest uppercase border border-white/20 text-white px-8 py-3 rounded-full hover:border-[#D4AF37] hover:bg-[#D4AF37] hover:text-black transition-all duration-500 shadow-lg">
            Member Login
          </Link>
        </div>
      </nav>

      {/* 2. Hero Section：修復字體重疊，增加呼吸感 */}
      <section id="concept" className="relative min-h-screen flex items-center px-6 md:px-12 pt-24 overflow-hidden">
        <div className="absolute right-[5%] top-[20%] w-[50vw] h-[50vw] max-w-[600px] max-h-[600px] bg-[#D4AF37]/10 rounded-full blur-[150px] -z-10 pointer-events-none"></div>
        
        <div className="max-w-7xl mx-auto w-full">
          <p className="text-[#D4AF37] tracking-[0.6em] md:tracking-[0.8em] text-[9px] md:text-[10px] font-bold mb-8 uppercase">
            Japanese & Korean Professional Salon
          </p>
          
          {/* 修正了 leading (行距) 與排版，讓中文字不再擠在一起 */}
          <h1 className="text-5xl md:text-7xl lg:text-[90px] font-light text-white mb-12 tracking-wide leading-[1.3] md:leading-[1.2]">
            塑造 <span className="italic font-serif text-[#D4AF37] mx-2">靈魂</span> 的 <br className="hidden md:block" />
            <span className="font-black mt-2 md:mt-4 block">新輪廓<span className="text-[#D4AF37]">。</span></span>
          </h1>
          
          <div className="max-w-xl mb-16 border-l pl-6 border-white/20">
            <p className="text-gray-400 text-sm md:text-base leading-[2.2] font-light tracking-wider">
              摒棄冗贅，專注於髮絲的質感與流向。<br/>
              結合資生堂專業工藝與雲端智能，在大埔與樂富，<br/>
              為每一位追求細節的您，量身打造專屬潮流標籤。
            </p>
          </div>
          
          <Link href="/login" className="inline-flex items-center gap-6 group">
            <div className="w-14 h-14 md:w-16 md:h-16 rounded-full border border-white/20 flex items-center justify-center group-hover:bg-[#D4AF37] group-hover:border-[#D4AF37] transition-all duration-500">
              <i className="fa-solid fa-arrow-right text-white group-hover:text-black transition-colors"></i>
            </div>
            <span className="text-[10px] md:text-xs font-black tracking-[0.4em] uppercase text-white group-hover:text-[#D4AF37] transition-colors">立即登記領取迎新 $100</span>
          </Link>
        </div>
      </section>

      {/* 3. 核心賣點：大間距，俐落排版 */}
      <section className="py-32 px-6 md:px-12 border-t border-white/5 bg-gradient-to-b from-white/[0.02] to-transparent">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-16 md:gap-24">
          <div className="space-y-6">
            <span className="text-[#D4AF37] text-[10px] font-bold tracking-[0.4em] uppercase">01 / Craft</span>
            <h3 className="text-2xl font-bold text-white tracking-widest">資生堂專業工藝</h3>
            <p className="text-gray-500 text-sm leading-[2]">指定選用 Shiseido Professional 系列產品。從染膏配比到燙髮溫控，每一道工序皆體現對細節的極致追求。</p>
          </div>
          <div className="space-y-6">
            <span className="text-[#D4AF37] text-[10px] font-bold tracking-[0.4em] uppercase">02 / Trend</span>
            <h3 className="text-2xl font-bold text-white tracking-widest">日韓潮流指標</h3>
            <p className="text-gray-500 text-sm leading-[2]">同步東京、首爾最新髮型趨勢。不論是空氣感剪裁還是透明感染髮，專業設計師都能精準呈現您的獨特氣質。</p>
          </div>
          <div className="space-y-6">
            <span className="text-[#D4AF37] text-[10px] font-bold tracking-[0.4em] uppercase">03 / Tech</span>
            <h3 className="text-2xl font-bold text-white tracking-widest">雲端科技體驗</h3>
            <p className="text-gray-500 text-sm leading-[2]">引進雲端智能會員系統。透過線上預約、專屬 QR Code 支付與點數回饋，享受尊榮無縫的科技便利。</p>
          </div>
        </div>
      </section>

      {/* 4. CMS 動態優惠：優化卡片比例與質感 */}
      {promos.length > 0 && (
        <section id="promos" className="py-32 px-6 md:px-12 border-t border-white/5 relative">
          <div className="max-w-7xl mx-auto">
            <div className="mb-16">
              <h2 className="text-3xl font-black text-white italic mb-3 tracking-wide">Limited <span className="text-[#D4AF37]">Offers</span></h2>
              <p className="text-gray-500 text-[10px] tracking-[0.5em] uppercase">最新會員專屬禮遇</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
              {promos.map(promo => (
                <div key={promo.id} className="bg-[#121212] border border-white/5 p-10 md:p-14 rounded-[40px] relative overflow-hidden group hover:border-[#D4AF37]/30 transition-colors duration-500">
                  <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-20 transition-opacity duration-500 transform group-hover:scale-110">
                     <i className="fa-solid fa-bolt text-[#D4AF37] text-6xl"></i>
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-6 leading-relaxed tracking-widest">{promo.title}</h3>
                  <p className="text-gray-400 text-sm leading-[2] mb-12 font-light">{promo.content}</p>
                  <div className="inline-flex items-center bg-white/5 px-4 py-2 rounded-full text-[9px] text-[#D4AF37] font-bold tracking-widest uppercase">
                    <i className="fa-regular fa-clock mr-2"></i> Valid until {promo.expiry}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 5. 服務頻道：菜單式精緻排版 */}
      <section id="services" className="py-32 px-6 md:px-12 border-t border-white/5 bg-[#0a0a0a]">
        <div className="max-w-5xl mx-auto">
          <div className="mb-20 text-center">
            <h2 className="text-4xl font-black text-white italic mb-4 tracking-wide">Studio <span className="text-[#D4AF37]">Menu</span></h2>
            <p className="text-gray-500 text-[10px] tracking-[0.5em] uppercase">專業收費及推薦項目</p>
          </div>
          
          <div className="space-y-2">
            {services.map(s => (
              <div key={s.id} className="group flex flex-col md:flex-row justify-between md:items-center py-8 border-b border-white/5 hover:border-[#D4AF37]/50 transition-all duration-500">
                <div className="mb-4 md:mb-0">
                  <p className="text-[9px] font-bold tracking-[0.4em] text-[#D4AF37] uppercase mb-2 opacity-80">{s.category || 'Special Care'}</p>
                  <h4 className="text-xl md:text-2xl font-light text-white tracking-widest">{s.name}</h4>
                </div>
                <div className="flex items-center justify-between md:justify-end w-full md:w-auto">
                  <span className="text-3xl font-light text-white tracking-tighter">
                    <span className="text-sm font-bold text-[#D4AF37] mr-2 block md:inline-block">$</span>
                    {s.price}
                  </span>
                  <Link href="/login" className="ml-8 md:ml-12 text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-[#D4AF37] transition-colors border-l border-white/10 pl-6 md:pl-12 py-2">
                    Book Now
                  </Link>
                </div>
              </div>
            ))}
            {services.length === 0 && (
              <p className="text-center text-gray-600 text-sm tracking-widest py-10">讀取價目表中...</p>
            )}
          </div>
        </div>
      </section>

      {/* 6. 真實口碑：整齊的卡片佈局 */}
      <section id="reviews" className="py-32 px-6 md:px-12 bg-[#121212] border-t border-white/5">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
            {[
              { name: "Ms. Wong", content: "日系染髮非常持久，線上預約跟 WhatsApp 收據真的好方便，不用怕弄丟紙本。" },
              { name: "Mr. Cheung", content: "資生堂套餐 CP 值極高，設計師溝通很有耐性，能準確剪出我想要的層次感。" },
              { name: "Apple Li", content: "樂富店環境優雅，出示 QR Code 扣款很快，完全是高階沙龍的體驗。" }
            ].map((review, i) => (
              <div key={i} className="space-y-8 p-10 bg-[#080808] border border-white/5 rounded-[40px] hover:-translate-y-2 transition-transform duration-500 shadow-xl">
                <div className="flex text-[#D4AF37] text-xs gap-1">
                  <i className="fa-solid fa-star"></i><i className="fa-solid fa-star"></i><i className="fa-solid fa-star"></i><i className="fa-solid fa-star"></i><i className="fa-solid fa-star"></i>
                </div>
                <p className="text-gray-400 text-sm font-light leading-[2.2] tracking-wide">"{review.content}"</p>
                <p className="text-white text-[10px] font-bold tracking-[0.2em] uppercase">— {review.name}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 7. 聯絡資訊與地圖：修正大埔地址 */}
      <section id="locations" className="py-32 px-6 md:px-12 border-t border-white/5">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-20 lg:gap-32 items-center">
          <div className="space-y-20 order-2 lg:order-1">
            <div>
              <h3 className="text-[10px] font-bold tracking-[0.6em] text-[#D4AF37] uppercase mb-16 italic">The Studios</h3>
              <div className="space-y-16">
                {/* 🟢 大埔店地址已更新為 88 廣場 */}
                <div className="group">
                  <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">Tai Po • 大埔旗艦店</h4>
                  <p className="text-xl md:text-2xl font-light text-white leading-loose tracking-widest mb-4 group-hover:text-[#D4AF37] transition-colors">
                    大埔昌運中心商場1樓<br/>41號舖
                  </p>
                  <p className="text-[11px] text-[#D4AF37] font-mono tracking-widest">WhatsApp. 9876 5432</p>
                </div>
                
                <div className="pt-16 border-t border-white/5 group">
                  <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-4">Lok Fu • 樂富店</h4>
                  <p className="text-xl md:text-2xl font-light text-white leading-loose tracking-widest mb-4 group-hover:text-[#D4AF37] transition-colors">
                    樂富廣場A 區 2樓2128號舖<br/>(UNY 附近)
                  </p>
                  <p className="text-[11px] text-[#D4AF37] font-mono tracking-widest">WhatsApp. 9123 4567</p>
                </div>
              </div>
            </div>
            
            {/* 社群連結 */}
            <div className="flex gap-10">
              <a href="https://www.facebook.com/Trust.HairSalon.TaiPo/" target="_blank" rel="noreferrer" className="text-[10px] font-bold tracking-[0.3em] text-gray-500 hover:text-white transition-colors uppercase border-b border-white/10 pb-2">Facebook</a>
              <a href="https://www.instagram.com/trust_hairsalon_taipo/" target="_blank" rel="noreferrer" className="text-[10px] font-bold tracking-[0.3em] text-gray-500 hover:text-white transition-colors uppercase border-b border-white/10 pb-2">Instagram</a>
            </div>
          </div>

          {/* 右側視覺區：品牌形象 */}
          <div className="relative aspect-[4/5] md:aspect-[3/4] bg-[#121212] rounded-[60px] overflow-hidden group border border-white/5 order-1 lg:order-2 shadow-2xl">
            <img src="https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&q=80&w=1000" alt="Salon Vibe" className="w-full h-full object-cover opacity-50 grayscale group-hover:grayscale-0 transition-all duration-1000 scale-105 group-hover:scale-100" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#080808] via-[#080808]/20 to-transparent"></div>
            <div className="absolute bottom-12 md:bottom-16 left-10 md:left-12 right-10">
               <p className="text-white text-2xl md:text-3xl font-light italic leading-relaxed tracking-wide">
                 "Professionalism<br/>is an <span className="text-[#D4AF37]">Attitude</span>."
               </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="py-12 text-center border-t border-white/5 bg-[#080808]">
        <p className="text-[8px] text-gray-600 tracking-[0.6em] font-bold uppercase">
          © {new Date().getFullYear()} Trust Hair Salon Group. Excellence in Every Strand.
        </p>
      </footer>
    </div>
  );
}