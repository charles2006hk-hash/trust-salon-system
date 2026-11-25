"use client";

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { db, auth } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { Toaster, toast } from 'react-hot-toast';

export default function MemberRecordsPage() {
  const { id } = useParams();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [member, setMember] = useState(null);
  const [activeTab, setActiveTab] = useState('topup'); // 'topup' | 'consume'
  const [allLogs, setAllLogs] = useState([]);

  // 分頁控制
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) return router.push('/login');
      const uSnap = await getDoc(doc(db, 'users', user.uid));
      if (uSnap.exists() && uSnap.data().role === 'member') {
        toast.error("⛔ 權限不足");
        return router.push('/dashboard');
      }
      fetchMemberAndLogs();
    });
    return () => unsubscribe();
  }, [id]);

  // 切換 Tab 時重置回第 1 頁
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab]);

  const fetchMemberAndLogs = async () => {
    setLoading(true);
    try {
      const memberSnap = await getDoc(doc(db, 'users', id));
      if (!memberSnap.exists()) {
        toast.error("找不到此會員資料");
        return router.push('/admin/users');
      }
      setMember({ id: memberSnap.id, ...memberSnap.data() });

      // 單一條件查詢避免觸發 Firestore 複合索引報錯，於前端排序與分頁
      const q = query(collection(db, 'transactions'), where('userId', '==', id));
      const txSnap = await getDocs(q);
      const logs = txSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

      setAllLogs(logs);
    } catch (error) {
      console.error(error);
      toast.error("讀取紀錄失敗");
    } finally {
      setLoading(false);
    }
  };

  // 篩選 Tab 1 (充值紀錄) 與 Tab 2 (消費紀錄)
  const topupLogs = allLogs.filter(
    tx => tx.type === 'topup' || (tx.type === 'admin_adjustment' && Number(tx.tDollarAdded) > 0)
  );
  const consumeLogs = allLogs.filter(
    tx => ['deduct', 'member_cash', 'deduct_package', 'deduct_points'].includes(tx.type) ||
          (tx.type === 'admin_adjustment' && Number(tx.tDollarAdded) < 0)
  );

  const currentList = activeTab === 'topup' ? topupLogs : consumeLogs;
  const totalPages = Math.max(1, Math.ceil(currentList.length / itemsPerPage));
  const paginatedList = currentList.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  if (loading) {
    return <div className="min-h-screen bg-[#080808] flex items-center justify-center text-[#D4AF37] font-bold">載入會員紀錄中...</div>;
  }

  return (
    <div className="min-h-screen bg-[#080808] text-gray-200 p-6 md:p-10 font-sans pb-24">
      <Toaster position="top-right" />
      <div className="max-w-6xl mx-auto">
        
        {/* 返回與標題 */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => router.push('/admin/users')}
            className="bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2 rounded-xl text-xs font-bold tracking-widest transition flex items-center gap-2"
          >
            <i className="fa-solid fa-arrow-left"></i> 返回會員管理
          </button>
          <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
            唯讀稽核模式 (Read-Only)
          </span>
        </div>

        {/* 頂部：會員基本資料卡片 */}
        {member && (
          <div className="bg-[#121212] p-6 md:p-8 rounded-[32px] border border-[#D4AF37]/30 mb-8 shadow-2xl grid grid-cols-1 md:grid-cols-5 gap-6 items-center">
            <div className="md:col-span-2">
              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">會員姓名 / 電話</p>
              <h1 className="text-2xl font-black text-white">{member.name || '未設定姓名'}</h1>
              <p className="text-sm font-mono text-gray-400 mt-1">{member.phoneNumber || '無電話'}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mb-1">所屬店鋪</p>
              <span className="inline-block bg-green-500/10 text-green-400 border border-green-500/30 px-3 py-1 rounded-lg text-xs font-bold">
                📍 {member.branch === 'ALL' ? '全域通' : (member.branch || '未設定')}
              </span>
            </div>
            <div>
              <p className="text-[10px] text-[#D4AF37] font-bold uppercase tracking-widest mb-1">當前 T-DOLLAR 餘額</p>
              <p className="text-3xl font-black font-mono text-[#D4AF37]">
                ${Math.round(Number(member.tDollarBalance || 0)).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-blue-400 font-bold uppercase tracking-widest mb-1">積分 POINTS</p>
              <p className="text-3xl font-black font-mono text-white">
                {Math.round(Number(member.points || 0)).toLocaleString()}
              </p>
            </div>
          </div>
        )}

        {/* Tab 切換標籤 */}
        <div className="flex gap-2 mb-6 bg-[#121212] p-1.5 rounded-2xl border border-white/5 inline-flex">
          <button
            onClick={() => setActiveTab('topup')}
            className={`px-6 py-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'topup' ? 'bg-[#D4AF37] text-black shadow-lg' : 'text-gray-400 hover:text-white'
            }`}
          >
            💰 充值紀錄 ({topupLogs.length})
          </button>
          <button
            onClick={() => setActiveTab('consume')}
            className={`px-6 py-3 rounded-xl text-xs font-bold transition-all ${
              activeTab === 'consume' ? 'bg-white text-black shadow-lg' : 'text-gray-400 hover:text-white'
            }`}
          >
            ✂️ 消費紀錄 ({consumeLogs.length})
          </button>
        </div>

        {/* 資料表格 */}
        <div className="bg-[#121212] rounded-[32px] border border-white/5 overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            {activeTab === 'topup' ? (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[10px] text-gray-500 uppercase tracking-widest border-b border-white/10 bg-black/30">
                    <th className="p-5 font-bold">操作日期時間</th>
                    <th className="p-5 font-bold text-right">充值金額</th>
                    <th className="p-5 font-bold text-right">充值後 T-DOLLAR 新餘額</th>
                    <th className="p-5 font-bold">操作店鋪</th>
                    <th className="p-5 font-bold">操作員</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {paginatedList.map(tx => (
                    <tr key={tx.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="p-5 font-mono text-xs text-gray-400">
                        {tx.timestamp ? new Date(tx.timestamp).toLocaleString('zh-HK') : '--'}
                      </td>
                      <td className="p-5 font-mono font-bold text-green-400 text-right">
                        +${Math.round(Number(tx.tDollarAdded || tx.amountPaidHKD || 0)).toLocaleString()}
                      </td>
                      <td className="p-5 font-mono font-bold text-[#D4AF37] text-right">
                        {tx.balanceAfter !== undefined ? `$${Math.round(Number(tx.balanceAfter)).toLocaleString()}` : '--'}
                      </td>
                      <td className="p-5 text-xs font-bold text-gray-300">{tx.branch || '未指定'}</td>
                      <td className="p-5 text-xs text-gray-400">{tx.operatorName || tx.adminName || '--'}</td>
                    </tr>
                  ))}
                  {paginatedList.length === 0 && (
                    <tr><td colSpan="5" className="p-12 text-center text-gray-600 font-bold">尚無充值紀錄</td></tr>
                  )}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[10px] text-gray-500 uppercase tracking-widest border-b border-white/10 bg-black/30">
                    <th className="p-5 font-bold">消費日期時間</th>
                    <th className="p-5 font-bold text-right">消費金額</th>
                    <th className="p-5 font-bold">消費項目</th>
                    <th className="p-5 font-bold text-right">消費後剩餘 T-DOLLAR 餘額</th>
                    <th className="p-5 font-bold">消費店鋪</th>
                    <th className="p-5 font-bold">操作員</th>
                    <th className="p-5 font-bold">備註</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {paginatedList.map(tx => (
                    <tr key={tx.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="p-5 font-mono text-xs text-gray-400">
                        {tx.timestamp ? new Date(tx.timestamp).toLocaleString('zh-HK') : '--'}
                      </td>
                      <td className="p-5 font-mono font-bold text-white text-right">
                        {tx.type === 'deduct_package'
                          ? `-${tx.deductedGrids || 1} 次`
                          : `-$${Math.round(Number(tx.amount || Math.abs(tx.tDollarAdded || 0))).toLocaleString()}`}
                      </td>
                      <td className="p-5 font-bold text-gray-200">
                        {tx.service || tx.packageName || '一般消費'}
                        {tx.stylist && <span className="ml-2 text-[10px] text-[#D4AF37] bg-white/5 px-2 py-0.5 rounded">{tx.stylist}</span>}
                      </td>
                      <td className="p-5 font-mono font-bold text-[#D4AF37] text-right">
                        {tx.balanceAfter !== undefined ? `$${Math.round(Number(tx.balanceAfter)).toLocaleString()}` : '--'}
                      </td>
                      <td className="p-5 text-xs font-bold text-gray-300">{tx.branch || '未指定'}</td>
                      <td className="p-5 text-xs text-gray-400">{tx.operatorName || tx.stylist || '--'}</td>
                      <td className="p-5 text-xs text-gray-500">
                        {tx.note || (tx.type === 'member_cash' ? '現金/刷卡結帳' : tx.type === 'deduct_package' ? '套票扣次' : '--')}
                      </td>
                    </tr>
                  ))}
                  {paginatedList.length === 0 && (
                    <tr><td colSpan="7" className="p-12 text-center text-gray-600 font-bold">尚無消費紀錄</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* 分頁導覽列 */}
          {totalPages > 1 && (
            <div className="p-4 px-6 border-t border-white/10 flex justify-between items-center bg-black/20">
              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                第 {currentPage} / {totalPages} 頁（共 {currentList.length} 筆）
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded-xl text-xs font-bold"
                >
                  上一頁
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded-xl text-xs font-bold"
                >
                  下一頁
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
