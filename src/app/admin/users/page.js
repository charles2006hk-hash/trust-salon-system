"use client";

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { Toaster, toast } from 'react-hot-toast';

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState('all');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "users"));
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // 依照建立時間排序 (新的在前)
      data.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      setUsers(data);
    } catch (error) {
      console.error(error);
      toast.error("讀取用戶資料失敗");
    } finally {
      setLoading(false);
    }
  };

  // 🟢 修改用戶權限 (Role)
  const handleRoleChange = async (userId, newRole) => {
    if (!window.confirm(`確定要將此用戶更改為 ${newRole} 權限嗎？`)) return;
    const toastId = toast.loading("更新權限中...");
    try {
      await updateDoc(doc(db, "users", userId), { role: newRole });
      toast.success("權限已更新！", { id: toastId });
      fetchUsers();
    } catch (e) { toast.error("更新失敗", { id: toastId }); }
  };

  // 🟢 手動調整餘額 (老闆的特權)
  const handleBalanceAdjustment = async (userId, currentBal, type) => {
    const amount = prompt(`請輸入要增加或扣除的金額 (T-Dollar):\n目前餘額: $${currentBal}`);
    if (!amount || isNaN(amount)) return;
    
    const newBal = type === 'tDollarBalance' ? currentBal + Number(amount) : currentBal + Number(amount);
    if (newBal < 0) return toast.error("餘額不能小於 0");

    const toastId = toast.loading("更新資產中...");
    try {
      await updateDoc(doc(db, "users", userId), { [type]: newBal });
      toast.success("資產更新成功！", { id: toastId });
      fetchUsers();
    } catch (e) { toast.error("更新失敗", { id: toastId }); }
  };

  const filteredUsers = filterRole === 'all' ? users : users.filter(u => u.role === filterRole);

  if (loading) return <div className="p-10 text-[#D4AF37]">載入用戶資料中...</div>;

  return (
    <div className="p-6 md:p-10">
      <Toaster position="top-right" />
      
      <header className="mb-10">
        <h1 className="text-3xl font-black text-white italic tracking-tighter mb-2">USER <span className="text-[#D4AF37]">MANAGEMENT</span></h1>
        <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">客戶與內部員工權限控制台</p>
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

      <div className="bg-[#121212] rounded-[32px] border border-white/5 overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-gray-500 uppercase tracking-widest border-b border-white/5 bg-black/20">
                <th className="p-6 font-bold">識別資訊 (ID/Phone)</th>
                <th className="p-6 font-bold">註冊時間</th>
                <th className="p-6 font-bold">資產狀態</th>
                <th className="p-6 font-bold">系統權限 (Role)</th>
                <th className="p-6 font-bold text-right">操作</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {filteredUsers.map(u => (
                <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="p-6">
                    <p className="text-white font-bold text-base mb-1">{u.phoneNumber || u.email || '未綁定'}</p>
                    <p className="text-[9px] text-gray-600 font-mono">{u.id}</p>
                  </td>
                  <td className="p-6 text-xs text-gray-400 font-mono">
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '早期帳號'}
                  </td>
                  <td className="p-6">
                    <div className="flex items-center gap-4">
                      <div className="cursor-pointer group" onClick={() => handleBalanceAdjustment(u.id, u.tDollarBalance || 0, 'tDollarBalance')} title="點擊手動修改 T-Dollar">
                        <p className="text-[9px] text-gray-500 uppercase tracking-widest mb-1">T-Dollar <i className="fa-solid fa-pen text-[8px] opacity-0 group-hover:opacity-100 ml-1"></i></p>
                        <p className="text-[#D4AF37] font-bold font-mono">${u.tDollarBalance || 0}</p>
                      </div>
                      <div className="cursor-pointer group" onClick={() => handleBalanceAdjustment(u.id, u.points || 0, 'points')} title="點擊手動修改積分">
                        <p className="text-[9px] text-gray-500 uppercase tracking-widest mb-1">Points <i className="fa-solid fa-pen text-[8px] opacity-0 group-hover:opacity-100 ml-1"></i></p>
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
                     {/* 預留未來發送訊息等功能 */}
                     <button className="text-[10px] bg-white/5 hover:bg-white/10 px-4 py-2 rounded-lg text-gray-400 transition font-bold uppercase">Details</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
