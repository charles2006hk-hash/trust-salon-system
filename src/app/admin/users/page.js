"use client";

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc, addDoc, query, where } from 'firebase/firestore';
import { Toaster, toast } from 'react-hot-toast';

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState('all');

  // 🟢 新增用戶 Modal 狀態
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', phone: '', role: 'member', tDollar: 0, points: 0 });

  // 🟢 用戶詳情 Modal 狀態
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [staffStats, setStaffStats] = useState({ clientCount: 0, revenue: 0 });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "users"));
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      setUsers(data);
    } catch (error) {
      toast.error("讀取用戶資料失敗");
    } finally {
      setLoading(false);
    }
  };

  // 🟢 1. 手動新增用戶 (後台直接開戶)
  const handleCreateUser = async (e) => {
    e.preventDefault();
    const toastId = toast.loading("正在建立用戶資料...");
    try {
      await addDoc(collection(db, "users"), {
        name: newUser.name,
        phoneNumber: newUser.phone,
        role: newUser.role,
        tDollarBalance: Number(newUser.tDollar),
        points: Number(newUser.points),
        createdAt: new Date().toISOString(),
        notes: ''
      });
      toast.success("開戶成功！", { id: toastId });
      setIsCreateOpen(false);
      setNewUser({ name: '', phone: '', role: 'member', tDollar: 0, points: 0 });
      fetchUsers();
    } catch (error) {
      toast.error("開戶失敗", { id: toastId });
    }
  };

  // 🟢 2. 開啟詳情面板 (並計算員工績效)
  const openDetails = async (user) => {
    setSelectedUser(user);
    setIsDetailOpen(true);

    // 如果是員工或老闆，去計算他的業績與客數
    if (user.role === 'staff' || user.role === 'admin') {
      try {
        const q = query(collection(db, 'transactions'), where('type', '==', 'deduct'));
        const snap = await getDocs(q);
        let count = 0;
        let rev = 0;
        
        snap.forEach(d => {
          const tx = d.data();
          // 利用姓名匹配業績 (POS 結帳時選的設計師名字)
          if (tx.stylist && user.name && tx.stylist.includes(user.name)) {
            count++;
            rev += Number(tx.amount || 0);
          }
        });
        setStaffStats({ clientCount: count, revenue: rev });
      } catch (error) {
        console.error("結算業績失敗", error);
      }
    }
  };

  // 🟢 3. 儲存用戶詳情修改
  const saveUserDetails = async () => {
    setIsSaving(true);
    const toastId = toast.loading("儲存設定中...");
    try {
      await updateDoc(doc(db, "users", selectedUser.id), {
        name: selectedUser.name || '',
        phoneNumber: selectedUser.phoneNumber || '',
        email: selectedUser.email || '',
        role: selectedUser.role,
        notes: selectedUser.notes || ''
      });
      toast.success("資料已更新！", { id: toastId });
      setIsDetailOpen(false);
      fetchUsers();
    } catch (error) {
      toast.error("更新失敗", { id: toastId });
    } finally {
      setIsSaving(false);
    }
  };

  // 快速修改權限與資產 (維持原本的快捷操作)
  const handleRoleChange = async (userId, newRole) => {
    if (!window.confirm(`確定要將此用戶更改為 ${newRole} 權限嗎？`)) return;
    try {
      await updateDoc(doc(db, "users", userId), { role: newRole });
      toast.success("權限已更新！");
      fetchUsers();
    } catch (e) { toast.error("更新失敗"); }
  };

  const filteredUsers = filterRole === 'all' ? users : users.filter(u => u.role === filterRole);

  if (loading) return <div className="p-10 text-[#D4AF37]">載入用戶資料中...</div>;

  return (
    <div className="p-6 md:p-10 pb-32">
      <Toaster position="top-right" />
      
      <header className="mb-10 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 className="text-3xl font-black text-white italic tracking-tighter mb-2">USER <span className="text-[#D4AF37]">MANAGEMENT</span></h1>
          <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">客戶與內部員工權限控制台</p>
        </div>
        <button onClick={() => setIsCreateOpen(true)} className="bg-[#D4AF37] text-black px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-transform shadow-[0_0_20px_rgba(212,175,55,0.3)]">
          <i className="fa-solid fa-plus mr-2"></i> 新增用戶 / 員工
        </button>
      </header>

      {/* 篩選器 */}
      <div className="flex gap-3 mb-8">
        {['all', 'member', 'staff', 'admin'].map(role => (
          <button key={role} onClick={() => setFilterRole(role)}
            className={`px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all border ${filterRole === role ? 'bg-[#D4AF37] text-black border-[#D4AF37]' : 'bg-transparent text-gray-500 border-gray-800 hover:border-gray-500'}`}>
            {role === 'all' ? '全部' : role}
          </button>
        ))}
      </div>

      {/* 用戶清單 */}
      <div className="bg-[#121212] rounded-[32px] border border-white/5 overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-gray-500 uppercase tracking-widest border-b border-white/5 bg-black/20">
                <th className="p-6 font-bold">姓名與識別資訊</th>
                <th className="p-6 font-bold">註冊時間</th>
                <th className="p-6 font-bold">資產狀態 (點擊可改)</th>
                <th className="p-6 font-bold">系統權限 (Role)</th>
                <th className="p-6 font-bold text-right">操作</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {filteredUsers.map(u => (
                <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="p-6">
                    <p className="text-white font-bold text-base mb-1 flex items-center gap-2">
                      {u.name || '未設定姓名'} 
                      {u.role === 'staff' && <i className="fa-solid fa-scissors text-[#D4AF37] text-xs"></i>}
                    </p>
                    <p className="text-[10px] text-gray-500 font-mono tracking-widest">{u.phoneNumber || u.email || '無綁定聯絡方式'}</p>
                  </td>
                  <td className="p-6 text-xs text-gray-400 font-mono">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '早期帳號'}
                  </td>
                  <td className="p-6">
                    <div className="flex items-center gap-4">
                      <div className="group">
                        <p className="text-[9px] text-gray-500 uppercase tracking-widest mb-1">T-Dollar</p>
                        <p className="text-[#D4AF37] font-bold font-mono">${u.tDollarBalance || 0}</p>
                      </div>
                      <div className="group">
                        <p className="text-[9px] text-gray-500 uppercase tracking-widest mb-1">Points</p>
                        <p className="text-white font-bold font-mono">{u.points || 0}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-6">
                    <select 
                      value={u.role || 'member'} 
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      className={`bg-black border p-2 rounded-lg text-xs font-bold outline-none cursor-pointer ${u.role === 'admin' ? 'border-red-500/50 text-red-400' : u.role === 'staff' ? 'border-blue-500/50 text-blue-400' : 'border-white/10 text-gray-300'}`}
                    >
                      <option value="member">會員 (Member)</option>
                      <option value="staff">員工 (Staff)</option>
                      <option value="admin">老闆 (Admin)</option>
                    </select>
                  </td>
                  <td className="p-6 text-right">
                     <button onClick={() => openDetails(u)} className="text-[10px] bg-white/5 hover:bg-[#D4AF37] hover:text-black px-5 py-2.5 rounded-xl text-gray-400 transition font-bold uppercase tracking-widest">
                       Details
                     </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 🟢 彈出視窗 1：新增用戶 Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-6 backdrop-blur-sm">
          <div className="bg-[#121212] w-full max-w-lg rounded-[40px] p-10 border border-white/10 shadow-2xl relative">
            <button onClick={() => setIsCreateOpen(false)} className="absolute top-6 right-6 text-gray-500 hover:text-white"><i className="fa-solid fa-xmark text-xl"></i></button>
            <h2 className="text-2xl font-black text-white italic mb-8">Create <span className="text-[#D4AF37]">User</span></h2>
            
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">姓名 (必填)</label>
                  <input type="text" required value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} className="w-full bg-black border border-white/10 p-3 rounded-xl text-white outline-none focus:border-[#D4AF37]" placeholder="如: Ivan / 陳大文" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">電話號碼</label>
                  <input type="text" value={newUser.phone} onChange={e => setNewUser({...newUser, phone: e.target.value})} className="w-full bg-black border border-white/10 p-3 rounded-xl text-white outline-none focus:border-[#D4AF37]" placeholder="+852..." />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">身分權限</label>
                <select value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value})} className="w-full bg-black border border-white/10 p-3 rounded-xl text-white outline-none focus:border-[#D4AF37]">
                  <option value="member">一般會員 (Member)</option>
                  <option value="staff">店內員工 / 髮型師 (Staff)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">初始 T-Dollar</label>
                  <input type="number" value={newUser.tDollar} onChange={e => setNewUser({...newUser, tDollar: e.target.value})} className="w-full bg-black border border-white/10 p-3 rounded-xl text-[#D4AF37] font-bold outline-none focus:border-[#D4AF37]" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">初始 積分</label>
                  <input type="number" value={newUser.points} onChange={e => setNewUser({...newUser, points: e.target.value})} className="w-full bg-black border border-white/10 p-3 rounded-xl text-white font-bold outline-none focus:border-[#D4AF37]" />
                </div>
              </div>

              <button type="submit" className="w-full bg-white text-black font-black py-4 rounded-xl uppercase tracking-widest text-xs hover:bg-[#D4AF37] transition-all mt-6 shadow-xl">
                確認開戶
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 🟢 彈出視窗 2：用戶詳情與員工績效 Modal */}
      {isDetailOpen && selectedUser && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-6 backdrop-blur-md">
          <div className="bg-[#121212] w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-[40px] border border-white/10 shadow-2xl relative custom-scrollbar">
            
            {/* 頂部 Header */}
            <div className="sticky top-0 bg-[#121212]/90 backdrop-blur px-10 py-8 border-b border-white/5 flex justify-between items-start z-10">
              <div className="flex items-center gap-6">
                <div className="w-16 h-16 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center text-3xl text-[#D4AF37]">
                  {selectedUser.role === 'staff' ? '✂️' : selectedUser.role === 'admin' ? '👑' : '👤'}
                </div>
                <div>
                  <h2 className="text-2xl font-black text-white">{selectedUser.name || '未設定姓名'}</h2>
                  <p className="text-[10px] font-mono text-gray-500 mt-1">{selectedUser.id}</p>
                </div>
              </div>
              <button onClick={() => setIsDetailOpen(false)} className="w-10 h-10 bg-white/5 rounded-full text-gray-400 hover:text-white transition flex items-center justify-center"><i className="fa-solid fa-xmark"></i></button>
            </div>

            <div className="p-10 space-y-8">
              {/* 🟢 如果是員工，顯示績效儀表板 */}
              {(selectedUser.role === 'staff' || selectedUser.role === 'admin') && (
                <div className="bg-gradient-to-br from-[#1a1a1a] to-black p-6 rounded-3xl border border-[#D4AF37]/30 shadow-lg">
                  <h3 className="text-[10px] font-bold text-[#D4AF37] uppercase tracking-[0.4em] mb-6 flex items-center gap-2">
                    <i className="fa-solid fa-chart-simple"></i> Staff Performance
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white/5 p-4 rounded-2xl">
                      <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">服務客數 (Clients)</p>
                      <p className="text-3xl font-black text-white">{staffStats.clientCount} <span className="text-xs text-gray-500 font-normal">位</span></p>
                    </div>
                    <div className="bg-[#D4AF37]/10 p-4 rounded-2xl border border-[#D4AF37]/20">
                      <p className="text-[10px] text-[#D4AF37] uppercase tracking-widest mb-1">創造業績 (Revenue)</p>
                      <p className="text-3xl font-black text-[#D4AF37]"><span className="text-sm mr-1">$</span>{staffStats.revenue.toLocaleString()}</p>
                    </div>
                  </div>
                  <p className="text-[9px] text-gray-600 mt-4 leading-relaxed tracking-wider">
                    * 系統依照 POS 結帳時填寫的「設計師姓名」自動加總。請確保員工姓名與 POS 選單一致（如: Ivan）。
                  </p>
                </div>
              )}

              {/* 基本資料編輯表單 */}
              <div>
                <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.4em] mb-4">Profile Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest ml-1">顯示姓名</label>
                    <input type="text" value={selectedUser.name || ''} onChange={e => setSelectedUser({...selectedUser, name: e.target.value})} className="w-full bg-black border border-white/5 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37] text-sm" placeholder="輸入姓名" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest ml-1">聯絡電話</label>
                    <input type="text" value={selectedUser.phoneNumber || ''} onChange={e => setSelectedUser({...selectedUser, phoneNumber: e.target.value})} className="w-full bg-black border border-white/5 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37] text-sm font-mono" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest ml-1">Email 信箱</label>
                    <input type="email" value={selectedUser.email || ''} onChange={e => setSelectedUser({...selectedUser, email: e.target.value})} className="w-full bg-black border border-white/5 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37] text-sm font-mono" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest ml-1">管理員備註 (Notes)</label>
                    <textarea value={selectedUser.notes || ''} onChange={e => setSelectedUser({...selectedUser, notes: e.target.value})} className="w-full bg-black border border-white/5 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37] text-sm h-24" placeholder="例如：VIP 客戶喜好、員工入職日期..." />
                  </div>
                </div>
              </div>

              <div className="flex gap-4 pt-4 border-t border-white/5">
                <button onClick={() => setIsDetailOpen(false)} className="flex-1 bg-white/5 text-white font-bold py-4 rounded-xl uppercase tracking-widest text-xs hover:bg-white/10 transition-all">
                  取消
                </button>
                <button onClick={saveUserDetails} disabled={isSaving} className="flex-1 bg-[#D4AF37] text-black font-black py-4 rounded-xl uppercase tracking-widest text-xs hover:scale-105 transition-transform disabled:opacity-50">
                  {isSaving ? '儲存中...' : '💾 儲存修改'}
                </button>
              </div>

            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #D4AF37; }
      `}</style>
    </div>
  );
}
