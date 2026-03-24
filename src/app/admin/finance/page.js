"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';

export default function FinancePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  
  // 財務數據狀態
  const [transactions, setTransactions] = useState([]);
  const [metrics, setMetrics] = useState({
    totalCashIn: 0,        // 總充值現金 (HKD)
    totalServiceValue: 0,  // 總消耗 T-Dollar (髮型師總業績)
    totalGivenPoints: 0,   // 總發放積分
    outstandingTDollar: 0  // 系統內尚未消費的 T-Dollar (負債)
  });
  
  // 髮型師與服務排行榜
  const [stylistRanking, setStylistRanking] = useState({});
  const [serviceRanking, setServiceRanking] = useState({});

  useEffect(() => {
    onAuthStateChanged(auth, (user) => {
      if (!user) return router.push('/login');
      // 這裡建議未來加入 role === 'admin' 的判斷，防止店員或客人進入
    });
    fetchFinancialData();
  }, []);

  const fetchFinancialData = async () => {
    setLoading(true);
    try {
      // 1. 抓取所有交易紀錄
      const q = query(collection(db, "transactions"), orderBy("timestamp", "desc"));
      const snap = await getDocs(q);
      const txs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // 2. 抓取所有用戶，計算「未消耗餘額」(負債)
      const usersSnap = await getDocs(collection(db, "users"));
      let totalOutstanding = 0;
      usersSnap.forEach(doc => {
        totalOutstanding += (doc.data().tDollarBalance || 0);
      });

      let cashIn = 0;
      let serviceValue = 0;
      let givenPoints = 0;
      let stylists = {};
      let services = {};

      // 3. 數據運算引擎
      txs.forEach(tx => {
        if (tx.type === 'topup') {
          cashIn += Number(tx.amountPaidHKD || 0);
          givenPoints += Number(tx.pointsAdded || 0);
        } 
        else if (tx.type === 'deduct') {
          const amount = Number(tx.amount || 0);
          serviceValue += amount;
          
          // 統計髮型師業績
          const stylistName = tx.stylist || '未指定';
          stylists[stylistName] = (stylists[stylistName] || 0) + amount;
          
          // 統計熱門服務
          const serviceName = tx.service || '一般服務';
          services[serviceName] = (services[serviceName] || 0) + amount;
        }
      });

      // 排序排行榜
      const sortedStylists = Object.entries(stylists).sort((a, b) => b[1] - a[1]);
      const sortedServices = Object.entries(services).sort((a, b) => b[1] - a[1]);

      setTransactions(txs);
      setMetrics({ totalCashIn: cashIn, totalServiceValue: serviceValue, totalGivenPoints: givenPoints, outstandingTDollar: totalOutstanding });
      setStylistRanking(sortedStylists);
      setServiceRanking(sortedServices);
      
    } catch (error) {
      console.error("讀取財務數據失敗:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#D4AF37] bg-[#080808]">報表生成中...</div>;

  return (
    <div className="bg-[#080808] min-h-screen text-gray-200 p-6 md:p-10 font-sans pb-24 selection:bg-[#D4AF37] selection:text-black">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      
      <div className="max-w-7xl mx-auto">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-12 gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tighter flex items-center gap-3 italic text-white">
              <span className="bg-[#D4AF37] text-black px-3 py-1 rounded-lg not-italic">EXECUTIVE</span>
              FINANCE
            </h1>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-2 font-bold">老闆專屬財務與業績看板</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => router.push('/admin/manage')} className="bg-gray-800 hover:bg-gray-700 px-6 py-2.5 rounded-xl text-xs font-bold transition">資料管理</button>
            <button onClick={() => router.push('/admin/pos')} className="bg-[#D4AF37]/10 text-[#D4AF37] border border-[#D4AF37]/30 hover:bg-[#D4AF37] hover:text-black px-6 py-2.5 rounded-xl text-xs font-bold transition">進入 POS</button>
          </div>
        </header>

        {/* 1. 核心財務指標 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          <div className="bg-[#121212] p-8 rounded-[32px] border border-white/5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-green-500/10 rounded-bl-[100px] -z-10"></div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">總現金流 (充值 HKD)</p>
            <p className="text-4xl font-black text-white tracking-tighter">${metrics.totalCashIn.toLocaleString()}</p>
          </div>
          
          <div className="bg-[#121212] p-8 rounded-[32px] border border-[#D4AF37]/30 relative overflow-hidden shadow-[0_0_20px_rgba(212,175,55,0.05)]">
            <div className="absolute top-0 right-0 w-24 h-24 bg-[#D4AF37]/10 rounded-bl-[100px] -z-10"></div>
            <p className="text-[10px] font-bold text-[#D4AF37] uppercase tracking-widest mb-2 flex justify-between">
              <span>店鋪總業績 (T-Dollar)</span>
              <i className="fa-solid fa-fire text-[#D4AF37]"></i>
            </p>
            <p className="text-4xl font-black text-[#D4AF37] tracking-tighter">${metrics.totalServiceValue.toLocaleString()}</p>
          </div>

          <div className="bg-[#121212] p-8 rounded-[32px] border border-white/5 relative overflow-hidden">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">已發放總積分 (Points)</p>
            <p className="text-4xl font-black text-white tracking-tighter">{metrics.totalGivenPoints.toLocaleString()}</p>
          </div>

          <div className="bg-[#1a1a1a] p-8 rounded-[32px] border border-red-500/20 relative overflow-hidden">
             <div className="absolute top-0 right-0 w-24 h-24 bg-red-500/10 rounded-bl-[100px] -z-10"></div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">系統未消費餘額 (負債)</p>
            <p className="text-4xl font-black text-gray-300 tracking-tighter">${metrics.outstandingTDollar.toLocaleString()}</p>
          </div>
        </div>

        {/* 2. 業績排行榜 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          
          {/* 髮型師抽成榜 */}
          <div className="bg-[#121212] p-10 rounded-[40px] border border-white/5 shadow-2xl">
            <div className="flex justify-between items-end mb-8 border-b border-white/5 pb-4">
              <h3 className="text-xl font-bold text-white italic">Stylist Performance</h3>
              <span className="text-[10px] bg-white/10 px-3 py-1 rounded-full text-gray-400">業績貢獻度</span>
            </div>
            
            <div className="space-y-6">
              {stylistRanking.length === 0 ? <p className="text-sm text-gray-600">尚無業績紀錄</p> : 
                stylistRanking.map(([name, val], index) => {
                  const percentage = metrics.totalServiceValue > 0 ? (val / metrics.totalServiceValue) * 100 : 0;
                  return (
                    <div key={name} className="relative">
                      <div className="flex justify-between text-sm font-bold uppercase tracking-widest mb-2">
                        <span className="flex items-center gap-3">
                          <span className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] ${index === 0 ? 'bg-[#D4AF37] text-black' : index === 1 ? 'bg-gray-300 text-black' : index === 2 ? 'bg-[#CD7F32] text-white' : 'bg-white/10 text-gray-400'}`}>
                            {index + 1}
                          </span>
                          {name}
                        </span>
                        <span className="text-[#D4AF37] font-mono">${val.toLocaleString()}</span>
                      </div>
                      <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden">
                        <div className="bg-[#D4AF37] h-full rounded-full transition-all duration-1000" style={{ width: `${percentage}%` }}></div>
                      </div>
                    </div>
                  );
                })
              }
            </div>
          </div>

          {/* 熱門服務項目榜 */}
          <div className="bg-[#121212] p-10 rounded-[40px] border border-white/5 shadow-2xl">
            <div className="flex justify-between items-end mb-8 border-b border-white/5 pb-4">
              <h3 className="text-xl font-bold text-white italic">Top Services</h3>
              <span className="text-[10px] bg-white/10 px-3 py-1 rounded-full text-gray-400">營收佔比</span>
            </div>
            
            <div className="space-y-6">
              {serviceRanking.length === 0 ? <p className="text-sm text-gray-600">尚無項目紀錄</p> : 
                serviceRanking.slice(0, 5).map(([name, val], index) => {
                  const percentage = metrics.totalServiceValue > 0 ? (val / metrics.totalServiceValue) * 100 : 0;
                  return (
                    <div key={name} className="relative">
                      <div className="flex justify-between text-xs font-bold uppercase tracking-widest mb-2">
                        <span className="text-gray-300">{name}</span>
                        <span className="text-white font-mono">${val.toLocaleString()}</span>
                      </div>
                      <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-blue-500/80 h-full rounded-full transition-all duration-1000" style={{ width: `${percentage}%` }}></div>
                      </div>
                    </div>
                  );
                })
              }
            </div>
          </div>
        </div>

        {/* 3. 詳細交易流水 */}
        <div className="bg-[#121212] rounded-[40px] p-10 border border-white/5 shadow-2xl overflow-hidden">
          <h3 className="text-xl font-bold text-white mb-8 italic">Recent Transactions</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[10px] text-gray-500 uppercase tracking-widest border-b border-white/10">
                  <th className="pb-4 font-bold">時間 (Time)</th>
                  <th className="pb-4 font-bold">類型 (Type)</th>
                  <th className="pb-4 font-bold">客戶 (Customer)</th>
                  <th className="pb-4 font-bold">項目 / 髮型師</th>
                  <th className="pb-4 font-bold text-right">變動金額</th>
                </tr>
              </thead>
              <tbody className="text-sm font-light">
                {transactions.slice(0, 20).map((tx, i) => (
                  <tr key={tx.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="py-4 text-[10px] text-gray-500 font-mono uppercase">{new Date(tx.timestamp).toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute:'2-digit' })}</td>
                    <td className="py-4">
                      {tx.type === 'topup' ? (
                        <span className="text-[9px] bg-green-500/10 text-green-400 px-2 py-1 rounded uppercase tracking-widest font-bold">Top Up</span>
                      ) : (
                        <span className="text-[9px] bg-blue-500/10 text-blue-400 px-2 py-1 rounded uppercase tracking-widest font-bold">Service</span>
                      )}
                    </td>
                    <td className="py-4 text-white font-bold">{tx.phoneNumber}</td>
                    <td className="py-4 text-gray-400">
                      {tx.type === 'topup' ? `實付 $${tx.amountPaidHKD} HKD` : (
                        <span className="flex items-center gap-2">
                          {tx.service} <span className="text-[9px] bg-white/10 px-2 py-0.5 rounded text-[#D4AF37]">{tx.stylist}</span>
                        </span>
                      )}
                    </td>
                    <td className={`py-4 font-mono font-bold text-right ${tx.type === 'topup' ? 'text-green-500' : 'text-white'}`}>
                      {tx.type === 'topup' ? '+' : '-'}${tx.type === 'topup' ? tx.tDollarAdded : tx.amount}
                    </td>
                  </tr>
                ))}
                {transactions.length === 0 && (
                  <tr><td colSpan="5" className="py-10 text-center text-gray-600 font-bold tracking-widest">目前尚無任何交易紀錄</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
