"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, getDocs, query, orderBy, doc, getDoc, limit } from 'firebase/firestore'; 
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Toaster, toast } from 'react-hot-toast';

export default function SystemLogsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) return router.push('/login');
      const docSnap = await getDoc(doc(db, 'users', user.uid));
      
      if (docSnap.exists() && docSnap.data().role !== 'admin') {
        toast.error("⛔ 安全封鎖：僅限最高管理員 (Admin) 存取審計日誌！");
        router.push('/dashboard');
        return;
      }
      
      fetchLogs();
    });
    return () => unsubscribe();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      // 🟢 抓取全局審計日誌，以時間倒序排列，限制 100 筆避免效能問題
      const q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(100));
      const snap = await getDocs(q);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setLogs(data);
    } catch (error) {
      console.error(error);
      toast.error("讀取系統日誌失敗");
    } finally {
      setLoading(false);
    }
  };

  // 簡單過濾器 (支援搜尋手機號碼或操作者)
  const filteredLogs = logs.filter(log => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (log.customerPhone && log.customerPhone.includes(term)) ||
      (log.adminName && log.adminName.toLowerCase().includes(term))
    );
  });

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[#D4AF37] bg-[#080808]">載入全局日誌中...</div>;

  return (
    <div className="bg-[#080808] min-h-screen text-gray-200 p-6 md:p-10 font-sans pb-24 selection:bg-[#D4AF37] selection:text-black">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
      <Toaster position="top-right" />
      
      <div className="max-w-6xl mx-auto">
        <header className="mb-10 flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-white/5 pb-8">
          <div>
            <h1 className="text-3xl font-black tracking-tighter flex items-center gap-3 italic text-white mb-2">
              <span className="bg-purple-600 text-white px-3 py-1 rounded-lg not-italic">GLOBAL</span> AUDIT LOGS
            </h1>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
              全域系統安全與審計追蹤中心 (Admin Only)
            </p>
          </div>
          
          <div className="relative w-full md:w-64">
            <input 
              type="text" 
              placeholder="搜尋手機號碼或操作人員..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#121212] border border-white/10 px-4 py-2.5 rounded-xl text-white outline-none focus:border-purple-500 text-sm shadow-inner"
            />
          </div>
        </header>

        <div className="bg-[#121212] rounded-[32px] border border-white/5 overflow-hidden shadow-2xl animate-fade-in">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] text-gray-500 uppercase tracking-widest border-b border-white/10 bg-black/40">
                  <th className="p-5 font-bold">操作時間</th>
                  <th className="p-5 font-bold">操作人員</th>
                  <th className="p-5 font-bold">模組與動作</th>
                  <th className="p-5 font-bold">目標客戶 (Phone)</th>
                  <th className="p-5 font-bold">異動詳情 (Diff)</th>
                </tr>
              </thead>
              <tbody className="text-sm font-medium">
                {filteredLogs.map(log => (
                  <tr key={log.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="p-5 text-xs text-gray-400 font-mono">
                      {new Date(log.timestamp).toLocaleString('zh-HK')}
                    </td>
                    <td className="p-5">
                      <span className="text-[10px] bg-purple-500/10 text-purple-400 px-2 py-1 rounded border border-purple-500/30 uppercase tracking-widest font-bold">
                        <i className="fa-solid fa-user-shield mr-1"></i> {log.adminName}
                      </span>
                    </td>
                    <td className="p-5">
                      <p className="text-white font-bold text-xs">{log.module}</p>
                      <p className="text-[9px] text-gray-500 uppercase">{log.action}</p>
                    </td>
                    <td className="p-5 text-white font-mono font-bold text-xs">
                      {log.customerPhone}
                    </td>
                    <td className="p-5">
                      {/* 渲染財務修改的細節 */}
                      {log.action === 'edit_transaction' && log.changes && (
                        <div className="bg-black/50 p-3 rounded-xl border border-white/5 text-[10px] font-mono w-64">
                           <div className="grid grid-cols-2 gap-2">
                             <div className="text-red-400 line-through">
                               ${log.changes.oldAmount} <br/> {log.changes.oldStylist} <br/> {log.changes.oldService}
                             </div>
                             <div className="text-green-400 font-bold border-l border-white/10 pl-2">
                               ${log.changes.newAmount} <br/> {log.changes.newStylist} <br/> {log.changes.newService}
                             </div>
                           </div>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredLogs.length === 0 && (
                  <tr>
                    <td colSpan="5" className="p-20 text-center text-gray-600 font-bold tracking-widest">
                      尚無系統日誌紀錄
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      <style jsx>{`
        .animate-fade-in { animation: fadeIn 0.4s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
