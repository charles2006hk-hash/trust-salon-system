"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, getDocs, query, orderBy, doc, getDoc, limit, startAfter } from 'firebase/firestore'; 
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Toaster, toast } from 'react-hot-toast';

export default function SystemLogsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAction, setFilterAction] = useState('ALL'); // 🟢 新增：動作過濾器

  // 🟢 新增：分頁 (Cursor) 狀態
  const [lastVisible, setLastVisible] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_LIMIT = 50; // 每次抓取 50 筆

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) return router.push('/login');
      const docSnap = await getDoc(doc(db, 'users', user.uid));
      
      if (docSnap.exists() && docSnap.data().role !== 'admin') {
        toast.error("⛔ 安全封鎖：僅限最高管理員 (Admin) 存取審計日誌！");
        router.push('/dashboard');
        return;
      }
      
      fetchLogs(true);
    });
    return () => unsubscribe();
  }, []);

  const fetchLogs = async (isInitial = false) => {
    if (isInitial) setLoading(true);
    else setLoadingMore(true);

    try {
      let q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(PAGE_LIMIT));
      
      // 如果不是初始載入，且有上一筆紀錄的 cursor，則從該處繼續抓取
      if (!isInitial && lastVisible) {
        q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), startAfter(lastVisible), limit(PAGE_LIMIT));
      }

      const snap = await getDocs(q);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      if (snap.docs.length < PAGE_LIMIT) {
        setHasMore(false); // 已經抓到底了
      }

      if (snap.docs.length > 0) {
        setLastVisible(snap.docs[snap.docs.length - 1]); // 紀錄最後一筆，供下次分頁使用
      }

      if (isInitial) {
        setLogs(data);
      } else {
        setLogs(prev => [...prev, ...data]); // 附加到現有陣列
      }
    } catch (error) {
      console.error(error);
      toast.error("讀取系統日誌失敗");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // 複合過濾器 (支援搜尋手機號碼/操作者 + 動作分類)
  const filteredLogs = logs.filter(log => {
    const matchSearch = !searchTerm || (
      (log.customerPhone && log.customerPhone.includes(searchTerm)) ||
      (log.adminName && log.adminName.toLowerCase().includes(searchTerm.toLowerCase()))
    );
    const matchAction = filterAction === 'ALL' || log.action === filterAction;
    
    return matchSearch && matchAction;
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
          
          <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
            {/* 🟢 動作分類過濾器 */}
            <select 
              value={filterAction} 
              onChange={(e) => setFilterAction(e.target.value)}
              className="bg-[#121212] border border-white/10 px-4 py-2.5 rounded-xl text-white outline-none focus:border-purple-500 text-sm shadow-inner cursor-pointer"
            >
              <option value="ALL">全部動作 (All Actions)</option>
              <option value="delete_transaction">🗑️ 刪除單據 (Delete)</option>
              <option value="edit_transaction">✏️ 修改單據 (Edit)</option>
              <option value="admin_adjust_package">🔧 修正套票 (Adjust Pkg)</option>
            </select>

            <div className="relative w-full md:w-64">
              <input 
                type="text" 
                placeholder="搜尋手機號碼或人員..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-[#121212] border border-white/10 px-4 py-2.5 rounded-xl text-white outline-none focus:border-purple-500 text-sm shadow-inner"
              />
            </div>
          </div>
        </header>

        <div className="bg-[#121212] rounded-[32px] border border-white/5 overflow-hidden shadow-2xl animate-fade-in">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] text-gray-500 uppercase tracking-widest border-b border-white/10 bg-black/40">
                  <th className="p-5 font-bold whitespace-nowrap">操作時間</th>
                  <th className="p-5 font-bold whitespace-nowrap">操作人員</th>
                  <th className="p-5 font-bold whitespace-nowrap">模組與動作</th>
                  <th className="p-5 font-bold whitespace-nowrap">目標客戶 (Phone)</th>
                  <th className="p-5 font-bold min-w-[300px]">異動詳情 (Diff / Details)</th>
                </tr>
              </thead>
              <tbody className="text-sm font-medium">
                {filteredLogs.map(log => (
                  <tr key={log.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="p-5 text-xs text-gray-400 font-mono whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString('zh-HK')}
                    </td>
                    <td className="p-5 whitespace-nowrap">
                      <span className="text-[10px] bg-purple-500/10 text-purple-400 px-2 py-1 rounded border border-purple-500/30 uppercase tracking-widest font-bold">
                        <i className="fa-solid fa-user-shield mr-1"></i> {log.adminName}
                      </span>
                    </td>
                    <td className="p-5 whitespace-nowrap">
                      <p className="text-white font-bold text-xs">{log.module || 'System'}</p>
                      <p className="text-[9px] text-gray-500 uppercase">{log.action}</p>
                    </td>
                    <td className="p-5 text-white font-mono font-bold text-xs whitespace-nowrap">
                      {log.customerPhone || log.targetPhone || '---'}
                    </td>
                    <td className="p-5">
                      {/* 🟢 渲染財務刪除的細節 */}
                      {log.action === 'delete_transaction' && log.changes && (
                        <div className="bg-red-950/30 p-3 rounded-xl border border-red-500/20 text-[10px] font-mono inline-block">
                           <p className="text-red-400 font-bold mb-1"><i className="fa-solid fa-trash-can mr-1"></i> 刪除單據紀錄：</p>
                           <ul className="list-disc list-inside text-gray-400 space-y-0.5">
                             <li>金額: <span className="text-white">${log.changes.amount}</span></li>
                             <li>項目: <span className="text-white">{log.changes.service}</span></li>
                             <li>負責人: <span className="text-white">{log.changes.stylist}</span></li>
                           </ul>
                        </div>
                      )}

                      {/* 🟢 渲染財務修改的細節 */}
                      {log.action === 'edit_transaction' && log.changes && (
                        <div className="bg-black/50 p-3 rounded-xl border border-white/5 text-[10px] font-mono inline-block min-w-[250px]">
                           <div className="grid grid-cols-2 gap-3">
                             <div className="text-red-400 line-through">
                               ${log.changes.oldAmount} <br/> {log.changes.oldStylist} <br/> {log.changes.oldService}
                             </div>
                             <div className="text-green-400 font-bold border-l border-white/10 pl-3">
                               ${log.changes.newAmount} <br/> {log.changes.newStylist} <br/> {log.changes.newService}
                             </div>
                           </div>
                        </div>
                      )}

                      {/* 🟢 渲染套票修正的細節 */}
                      {log.action === 'admin_adjust_package' && (
                        <div className="bg-blue-950/30 p-3 rounded-xl border border-blue-500/20 text-[10px] font-mono inline-block">
                           <p className="text-blue-400 font-bold mb-1"><i className="fa-solid fa-wrench mr-1"></i> 手動修正套票：<span className="text-white">{log.packageName}</span></p>
                           <div className="flex items-center gap-2 mt-1">
                             <span className="text-gray-500 line-through">{log.oldGrids || 0} 次</span>
                             <i className="fa-solid fa-arrow-right text-gray-600"></i>
                             <span className="text-green-400 font-bold">{log.newGrids} 次</span>
                           </div>
                        </div>
                      )}

                      {/* 🟢 Fallback 泛型渲染 (相容舊資料或其他動作) */}
                      {log.action !== 'delete_transaction' && log.action !== 'edit_transaction' && log.action !== 'admin_adjust_package' && (
                        <div className="text-[10px] text-gray-400 break-all bg-white/5 p-2 rounded border border-white/5">
                          {log.detail ? log.detail : (log.changes ? JSON.stringify(log.changes) : '無詳細紀錄')}
                        </div>
                      )}

                      {/* 如果 delete 沒有 changes 但有 detail (相容另一種寫入方式) */}
                      {log.action === 'delete_transaction' && !log.changes && log.detail && (
                         <div className="bg-red-950/30 p-2 rounded border border-red-500/20 text-[10px] font-mono text-red-400">
                           {log.detail}
                         </div>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredLogs.length === 0 && (
                  <tr>
                    <td colSpan="5" className="p-20 text-center text-gray-600 font-bold tracking-widest">
                      {searchTerm || filterAction !== 'ALL' ? '找不到符合條件的日誌' : '尚無系統日誌紀錄'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          
          {/* 🟢 載入更多按鈕 */}
          {hasMore && filteredLogs.length > 0 && (
            <div className="p-6 border-t border-white/5 text-center bg-black/20">
              <button 
                onClick={() => fetchLogs(false)} 
                disabled={loadingMore}
                className="bg-purple-600/20 text-purple-400 border border-purple-500/30 hover:bg-purple-600 hover:text-white px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest transition-colors disabled:opacity-50"
              >
                {loadingMore ? <><i className="fa-solid fa-circle-notch fa-spin mr-2"></i> 載入中...</> : '載入更早的紀錄'}
              </button>
            </div>
          )}
        </div>
      </div>
      
      <style jsx>{`
        .animate-fade-in { animation: fadeIn 0.4s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
