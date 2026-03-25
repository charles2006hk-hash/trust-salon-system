"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase'; // 🟢 確保引入 auth
import { collection, getDocs, doc, updateDoc, addDoc, setDoc, query, where, deleteDoc } from 'firebase/firestore';
import { Toaster, toast } from 'react-hot-toast';

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState('all');

  // 新增用戶 Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  // 🟢 狀態擴充：加入 email 和 password
  const [newUser, setNewUser] = useState({ name: '', phone: '', email: '', password: '', role: 'member', tDollar: 0, points: 0 });

  // 用戶詳情 Modal
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [staffStats, setStaffStats] = useState({ clientCount: 0, revenue: 0 });
  const [isSaving, setIsSaving] = useState(false);

  // 權限定義矩陣 Modal
  const [isRoleMatrixOpen, setIsRoleMatrixOpen] = useState(false);

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

  // 🟢 終極版開戶邏輯：支援在背景建立 Email 帳號與密碼 (不登出老闆)
  const handleCreateUser = async (e) => {
    e.preventDefault();
    const toastId = toast.loading("正在同步建立系統帳號...");
    
    try {
      let finalUid = null;

      // 1. 如果是內部人員 (非 member)，透過 REST API 建立 Auth 帳號
      if (newUser.role !== 'member') {
        if (!newUser.email || !newUser.password) {
          return toast.error("建立內部員工帳號必須填寫 Email 與 初始密碼", { id: toastId });
        }
        
        // 使用 REST API 避免老闆被強制登出
        const apiKey = auth.app.options.apiKey;
        const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: newUser.email,
            password: newUser.password,
            returnSecureToken: false
          })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error.message || "建立 Auth 帳號失敗");
        finalUid = data.localId; // 取得新建立的 UID
      }

      // 2. 準備寫入 Firestore 的資料
      const userData = {
        name: newUser.name,
        phoneNumber: newUser.phone,
        email: newUser.email || '',
        role: newUser.role,
        tDollarBalance: Number(newUser.tDollar),
        points: Number(newUser.points),
        createdAt: new Date().toISOString(),
        status: 'active',
        notes: ''
      };

      // 3. 寫入資料庫
      if (finalUid) {
        // 如果是員工，使用剛剛 Auth 生成的 UID 作為文件 ID
        await setDoc(doc(db, "users", finalUid), userData);
        toast.success(`員工帳號建立成功！\n登入密碼：${newUser.password}`, { id: toastId, duration: 5000 });
      } else {
        // 如果是一般客人，由 Firestore 自動生成 ID
        await addDoc(collection(db, "users"), userData);
        toast.success("客戶檔案建立成功！", { id: toastId });
      }

      // 清空表單並關閉 Modal
      setIsCreateOpen(false);
      setNewUser({ name: '', phone: '', email: '', password: '', role: 'member', tDollar: 0, points: 0 });
      fetchUsers();
      
    } catch (error) {
      console.error(error);
      let errMsg = "建立失敗";
      if (error.message.includes('EMAIL_EXISTS')) errMsg = "此 Email 已經被註冊過了";
      if (error.message.includes('WEAK_PASSWORD')) errMsg = "密碼太弱，請至少輸入 6 個字元";
      toast.error(errMsg, { id: toastId });
    }
  };

  const openDetails = async (user) => {
    setSelectedUser(user);
    setIsDetailOpen(true);

    if (['staff', 'manager', 'admin'].includes(user.role)) {
      try {
        const q = query(collection(db, 'transactions'), where('type', '==', 'deduct'));
        const snap = await getDocs(q);
        let count = 0;
        let rev = 0;
        
        snap.forEach(d => {
          const tx = d.data();
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

  const handleRoleChange = async (userId, newRole) => {
    if (!window.confirm(`確定要將此用戶更改為 ${newRole} 權限嗎？`)) return;
    try {
      await updateDoc(doc(db, "users", userId), { role: newRole });
      toast.success("權限已更新！");
      fetchUsers();
    } catch (e) { toast.error("更新失敗"); }
  };

  const toggleUserStatus = async (user) => {
    const newStatus = user.status === 'suspended' ? 'active' : 'suspended';
    if (!window.confirm(`確定要將此帳戶設定為「${newStatus === 'suspended' ? '停權' : '正常'}」嗎？`)) return;
    
    try {
      await updateDoc(doc(db, "users", user.id), { status: newStatus });
      toast.success(`帳號已${newStatus === 'suspended' ? '停權' : '恢復正常'}`);
      fetchUsers();
    } catch(e) { toast.error("操作失敗"); }
  };

  const deleteUser = async (userId) => {
    if (!window.confirm("⚠️ 警告：這將徹底刪除該客人的所有餘額與資料，且無法復原！確定刪除？")) return;
    try {
      await deleteDoc(doc(db, "users", userId));
      toast.success("帳號已徹底刪除");
      fetchUsers();
    } catch(e) { toast.error("刪除失敗"); }
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
        <div className="flex gap-4">
          <button onClick={() => setIsRoleMatrixOpen(true)} className="bg-white/5 text-gray-300 border border-white/10 px-6 py-3 rounded-2xl text-xs font-bold tracking-widest hover:bg-white/10 transition-colors">
            <i className="fa-solid fa-shield-halved mr-2 text-[#D4AF37]"></i> 角色權限定義
          </button>
          <button onClick={() => setIsCreateOpen(true)} className="bg-[#D4AF37] text-black px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-transform shadow-[0_0_20px_rgba(212,175,55,0.3)]">
            <i className="fa-solid fa-plus mr-2"></i> 新增用戶
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-3 mb-8">
        {['all', 'member', 'reception', 'staff', 'manager', 'admin'].map(role => (
          <button key={role} onClick={() => setFilterRole(role)}
            className={`px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all border ${filterRole === role ? 'bg-[#D4AF37] text-black border-[#D4AF37]' : 'bg-transparent text-gray-500 border-gray-800 hover:border-gray-500'}`}>
            {role === 'all' ? '全部' : role}
          </button>
        ))}
      </div>

      <div className="bg-[#121212] rounded-[32px] border border-white/5 overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-gray-500 uppercase tracking-widest border-b border-white/5 bg-black/20">
                <th className="p-6 font-bold">姓名與識別資訊</th>
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
                    <p className="text-white font-bold text-base mb-1 flex items-center gap-2">
                      {u.name || '未設定姓名'} 
                      {u.role === 'admin' && <i className="fa-solid fa-crown text-[#D4AF37] text-xs"></i>}
                      {['staff', 'manager'].includes(u.role) && <i className="fa-solid fa-scissors text-[#D4AF37] text-xs"></i>}
                      {u.role === 'reception' && <i className="fa-solid fa-desktop text-blue-400 text-xs"></i>}
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
                      className={`bg-black border p-2 rounded-lg text-xs font-bold outline-none cursor-pointer ${
                        u.role === 'admin' ? 'border-red-500/50 text-red-400' : 
                        u.role === 'manager' ? 'border-purple-500/50 text-purple-400' : 
                        u.role === 'staff' ? 'border-blue-500/50 text-blue-400' : 
                        u.role === 'reception' ? 'border-green-500/50 text-green-400' : 
                        'border-white/10 text-gray-300'
                      }`}
                    >
                      <option value="member">會員 (Member)</option>
                      <option value="reception">櫃台 (Reception)</option>
                      <option value="staff">員工 (Staff)</option>
                      <option value="manager">經理 (Manager)</option>
                      <option value="admin">老闆 (Admin)</option>
                    </select>
                  </td>
                  <td className="p-6 text-right flex justify-end gap-2 items-center">
                     <button onClick={() => toggleUserStatus(u)} className={`text-[10px] px-4 py-2 rounded-xl font-bold uppercase tracking-widest transition ${u.status === 'suspended' ? 'bg-green-500/10 text-green-500 hover:bg-green-500 hover:text-white' : 'bg-orange-500/10 text-orange-500 hover:bg-orange-500 hover:text-white'}`}>
                       {u.status === 'suspended' ? '復權' : '停用'}
                     </button>
                     <button onClick={() => deleteUser(u.id)} className="text-[10px] bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white px-4 py-2 rounded-xl font-bold uppercase tracking-widest transition">
                       刪除
                     </button>
                     <button onClick={() => openDetails(u)} className="text-[10px] bg-white/5 hover:bg-[#D4AF37] hover:text-black px-4 py-2 rounded-xl text-gray-400 transition font-bold uppercase tracking-widest ml-2">
                       Details
                     </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 🟢 彈出視窗：動態表單 (根據角色顯示密碼欄位) */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-6 backdrop-blur-sm">
          <div className="bg-[#121212] w-full max-w-lg rounded-[40px] p-10 border border-white/10 shadow-2xl relative">
            <button onClick={() => setIsCreateOpen(false)} className="absolute top-6 right-6 text-gray-500 hover:text-white"><i className="fa-solid fa-xmark text-xl"></i></button>
            <h2 className="text-2xl font-black text-white italic mb-8">Create <span className="text-[#D4AF37]">User</span></h2>
            
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">身分權限</label>
                <select value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value})} className="w-full bg-black border border-[#D4AF37]/50 p-3 rounded-xl text-[#D4AF37] font-bold outline-none">
                  <option value="member">一般會員 (Member) - 無需密碼</option>
                  <option value="reception">櫃台人員 (Reception)</option>
                  <option value="staff">店內員工 / 髮型師 (Staff)</option>
                  <option value="manager">店鋪經理 (Manager)</option>
                  <option value="admin">系統管理員 (Admin)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">姓名 (必填)</label>
                  <input type="text" required value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} className="w-full bg-black border border-white/10 p-3 rounded-xl text-white outline-none focus:border-[#D4AF37]" placeholder="如: Ivan" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">電話號碼</label>
                  <input type="text" value={newUser.phone} onChange={e => setNewUser({...newUser, phone: e.target.value})} className="w-full bg-black border border-white/10 p-3 rounded-xl text-white outline-none focus:border-[#D4AF37]" placeholder="+852..." />
                </div>
              </div>

              {/* 🟢 如果不是一般會員，強制顯示 Email 與 密碼設定 */}
              {newUser.role !== 'member' && (
                <div className="grid grid-cols-2 gap-4 animate-fade-in border-t border-white/10 pt-4 mt-2">
                  <div className="space-y-1 col-span-2">
                    <p className="text-xs text-[#D4AF37] mb-2 font-bold"><i className="fa-solid fa-lock"></i> 內部人員登入憑證設定</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">登入 Email (必填)</label>
                    <input type="email" required={newUser.role !== 'member'} value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} className="w-full bg-black border border-white/10 p-3 rounded-xl text-white outline-none focus:border-[#D4AF37]" placeholder="ivan@trust.com" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">初始密碼 (必填, 最少6碼)</label>
                    <input type="text" required={newUser.role !== 'member'} minLength={6} value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} className="w-full bg-black border border-[#D4AF37]/50 p-3 rounded-xl text-white outline-none focus:border-[#D4AF37]" placeholder="設定預設密碼" />
                  </div>
                </div>
              )}

              <button type="submit" className="w-full bg-white text-black font-black py-4 rounded-xl uppercase tracking-widest text-xs hover:bg-[#D4AF37] transition-all mt-6 shadow-xl">
                {newUser.role !== 'member' ? '建立檔案並開通系統帳號' : '確認建立客戶檔案'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 權限對照矩陣 Modal (維持不變) */}
      {isRoleMatrixOpen && (
        <div className="fixed inset-0 bg-black/95 z-[70] flex items-center justify-center p-6 backdrop-blur-md">
          <div className="bg-[#121212] w-full max-w-4xl rounded-[40px] p-10 border border-[#D4AF37]/30 shadow-[0_0_50px_rgba(212,175,55,0.1)] relative">
            <button onClick={() => setIsRoleMatrixOpen(false)} className="absolute top-6 right-6 text-gray-500 hover:text-white"><i className="fa-solid fa-xmark text-xl"></i></button>
            
            <div className="mb-8 border-b border-white/10 pb-6">
              <h2 className="text-3xl font-black text-white italic tracking-tighter">Role <span className="text-[#D4AF37]">Permissions</span></h2>
              <p className="text-xs text-gray-400 mt-2 tracking-widest">各級職務系統存取權限對照表</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-center border-collapse">
                <thead>
                  <tr className="text-[10px] text-gray-400 uppercase tracking-widest border-b border-white/10">
                    <th className="p-4 text-left font-bold">系統模組 (Modules)</th>
                    <th className="p-4 font-bold border-l border-white/5"><span className="text-red-400 block">Admin</span>老闆</th>
                    <th className="p-4 font-bold border-l border-white/5"><span className="text-purple-400 block">Manager</span>經理</th>
                    <th className="p-4 font-bold border-l border-white/5"><span className="text-blue-400 block">Staff</span>員工</th>
                    <th className="p-4 font-bold border-l border-white/5"><span className="text-green-400 block">Reception</span>櫃台</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  <tr className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="p-4 text-left text-white font-bold"><i className="fa-solid fa-cash-register w-6 text-gray-500"></i> 前台收銀與結帳</td>
                    <td className="p-4 border-l border-white/5 text-[#D4AF37]"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 border-l border-white/5 text-[#D4AF37]"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 border-l border-white/5 text-[#D4AF37]"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 border-l border-white/5 text-[#D4AF37]"><i className="fa-solid fa-check"></i></td>
                  </tr>
                  <tr className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="p-4 text-left text-white font-bold"><i className="fa-solid fa-sliders w-6 text-gray-500"></i> 資料與 CMS 管理 (定價/優惠)</td>
                    <td className="p-4 border-l border-white/5 text-[#D4AF37]"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 border-l border-white/5 text-[#D4AF37]"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 border-l border-white/5 text-[#D4AF37]"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark"></i></td>
                  </tr>
                  <tr className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="p-4 text-left text-white font-bold"><i className="fa-solid fa-chart-pie w-6 text-gray-500"></i> 財務報表 (總營收/抽成計算)</td>
                    <td className="p-4 border-l border-white/5 text-[#D4AF37]"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 border-l border-white/5 text-[#D4AF37]"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark"></i></td>
                    <td className="p-4 border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark"></i></td>
                  </tr>
                  <tr className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="p-4 text-left text-white font-bold"><i className="fa-solid fa-users-gear w-6 text-gray-500"></i> 用戶與權限控制 (本頁面)</td>
                    <td className="p-4 border-l border-white/5 text-[#D4AF37]"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark"></i></td>
                    <td className="p-4 border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark"></i></td>
                    <td className="p-4 border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark"></i></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 用戶詳情 Modal (維持不變) */}
      {isDetailOpen && selectedUser && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-6 backdrop-blur-md">
          <div className="bg-[#121212] w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-[40px] border border-white/10 shadow-2xl relative custom-scrollbar">
            
            <div className="sticky top-0 bg-[#121212]/90 backdrop-blur px-10 py-8 border-b border-white/5 flex justify-between items-start z-10">
              <div className="flex items-center gap-6">
                <div className="w-16 h-16 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center text-3xl text-[#D4AF37]">
                  {['staff', 'manager'].includes(selectedUser.role) ? '✂️' : selectedUser.role === 'admin' ? '👑' : '👤'}
                </div>
                <div>
                  <h2 className="text-2xl font-black text-white">{selectedUser.name || '未設定姓名'}</h2>
                  <p className="text-[10px] font-mono text-gray-500 mt-1">{selectedUser.id}</p>
                </div>
              </div>
              <button onClick={() => setIsDetailOpen(false)} className="w-10 h-10 bg-white/5 rounded-full text-gray-400 hover:text-white transition flex items-center justify-center"><i className="fa-solid fa-xmark"></i></button>
            </div>

            <div className="p-10 space-y-8">
              {['staff', 'manager', 'admin'].includes(selectedUser.role) && (
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
                </div>
              )}

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
                <button onClick={() => setIsDetailOpen(false)} className="flex-1 bg-white/5 text-white font-bold py-4 rounded-xl uppercase tracking-widest text-xs hover:bg-white/10 transition-all">取消</button>
                <button onClick={saveUserDetails} disabled={isSaving} className="flex-1 bg-[#D4AF37] text-black font-black py-4 rounded-xl uppercase tracking-widest text-xs hover:scale-105 transition-transform disabled:opacity-50">
                  {isSaving ? '儲存中...' : '💾 儲存修改'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .animate-fade-in { animation: fadeIn 0.4s ease-in-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #D4AF37; }
      `}</style>
    </div>
  );
}
