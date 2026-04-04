"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc, addDoc, setDoc, query, where, deleteDoc, getDoc, runTransaction } from 'firebase/firestore'; // 🟢 補上 runTransaction
import { onAuthStateChanged } from 'firebase/auth';
import { Toaster, toast } from 'react-hot-toast';

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState('all');

  // 🟢 儲存當前操作者的 權限 與 UID
  const [currentAdminRole, setCurrentAdminRole] = useState('reception'); 
  const [currentUid, setCurrentUid] = useState(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', phone: '', email: '', password: '', role: 'member', tDollar: 0, points: 0 });

  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [staffStats, setStaffStats] = useState({ clientCount: 0, revenue: 0 });
  const [isSaving, setIsSaving] = useState(false);

  // 🟢 新增：手動調整資產的表單狀態
  const [adjustForm, setAdjustForm] = useState({ points: '', tDollar: '', note: '' });

  const [isRoleMatrixOpen, setIsRoleMatrixOpen] = useState(false);

  useEffect(() => {
    // 🟢 取得當前操作者的角色身分與 UID
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUid(user.uid);
        const docSnap = await getDoc(doc(db, 'users', user.uid));
        if (docSnap.exists()) setCurrentAdminRole(docSnap.data().role);
      }
    });
    fetchUsers();
    return () => unsubscribe();
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

  const handleCreateUser = async (e) => {
    e.preventDefault();
    const toastId = toast.loading("正在同步建立系統帳號...");
    
    try {
      let finalUid = null;

      if (newUser.role !== 'member') {
        if (currentAdminRole !== 'admin') {
           return toast.error("權限不足：只有老闆 (Admin) 可以建立內部員工帳號", { id: toastId });
        }
        if (!newUser.email || !newUser.password) {
          return toast.error("建立內部員工帳號必須填寫 Email 與 初始密碼", { id: toastId });
        }
        
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
        finalUid = data.localId;
      }

      const userData = {
        name: newUser.name,
        phoneNumber: newUser.phone,
        email: newUser.email || '',
        role: newUser.role,
        tDollarBalance: Number(newUser.tDollar),
        points: Number(newUser.points),
        packageBalances: {}, // 🟢 確保新註冊的客人也能無縫支援套票系統
        createdAt: new Date().toISOString(),
        status: 'active',
        notes: ''
      };

      if (finalUid) {
        await setDoc(doc(db, "users", finalUid), userData);
        toast.success(`員工帳號建立成功！\n登入密碼：${newUser.password}`, { id: toastId, duration: 5000 });
      } else {
        await addDoc(collection(db, "users"), userData);
        toast.success("客戶檔案建立成功！可進入 Details 派發註冊禮積分。", { id: toastId });
      }

      setIsCreateOpen(false);
      setNewUser({ name: '', phone: '', email: '', password: '', role: 'member', tDollar: 0, points: 0 });
      fetchUsers();
      
    } catch (error) {
      let errMsg = "建立失敗";
      if (error.message.includes('EMAIL_EXISTS')) errMsg = "此 Email 已經被註冊過了";
      if (error.message.includes('WEAK_PASSWORD')) errMsg = "密碼太弱，請至少輸入 6 個字元";
      toast.error(errMsg, { id: toastId });
    }
  };

  const openDetails = async (user) => {
    setSelectedUser(user);
    setAdjustForm({ points: '', tDollar: '', note: '' }); // 🟢 打開詳細視窗時，重置調整表單
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
        ...(currentAdminRole === 'admin' ? { role: selectedUser.role } : {}),
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

  // 🟢 核心功能：手動派發/扣除資產 (僅限老闆)
  const handleAssetAdjustment = async (e) => {
    e.preventDefault();
    if (currentAdminRole !== 'admin') return toast.error("⛔ 權限不足：僅限老闆操作此功能");
    
    const pts = Number(adjustForm.points) || 0;
    const td = Number(adjustForm.tDollar) || 0;
    if (pts === 0 && td === 0) return toast.error("請輸入要調整的數值");

    const isConfirm = window.confirm(`確認要進行以下調整嗎？\n\n積分變動: ${pts > 0 ? '+'+pts : pts} PTS\nT-Dollar變動: ${td > 0 ? '+$'+td : td < 0 ? '-$'+Math.abs(td) : '$0'}\n備註: ${adjustForm.note || '無'}`);
    if (!isConfirm) return;

    const toastId = toast.loading("資產更新中...");
    try {
      await runTransaction(db, async (tx) => {
        const userRef = doc(db, "users", selectedUser.id);
        const uDoc = await tx.get(userRef);
        const data = uDoc.data();

        const newPoints = (data.points || 0) + pts;
        const newTDollar = (data.tDollarBalance || 0) + td;

        if (newPoints < 0 || newTDollar < 0) throw new Error("扣除失敗：資產不能小於 0");

        tx.update(userRef, { points: newPoints, tDollarBalance: newTDollar });
        
        // 寫入交易流水帳，確保財務與發放紀錄有跡可循
        tx.set(doc(collection(db, "transactions")), {
          userId: selectedUser.id, phoneNumber: selectedUser.phoneNumber, type: "admin_adjustment",
          pointsAdded: pts, tDollarAdded: td, adminId: currentUid, note: adjustForm.note || '老闆手動調整', timestamp: new Date().toISOString()
        });
      });

      toast.success("資產發放/扣減完成！", { id: toastId });
      setAdjustForm({ points: '', tDollar: '', note: '' });
      setIsDetailOpen(false);
      fetchUsers();
    } catch (error) { toast.error(error.message, { id: toastId }); }
  };

  const handleRoleChange = async (userId, newRole) => {
    if (currentAdminRole !== 'admin') return toast.error("⛔ 權限不足：除了老闆，沒有人能修改系統權限！");
    if (!window.confirm(`確定要將此用戶更改為 ${newRole} 權限嗎？`)) return;
    try {
      await updateDoc(doc(db, "users", userId), { role: newRole });
      toast.success("權限已更新！");
      fetchUsers();
    } catch (e) { toast.error("更新失敗"); }
  };

  const toggleUserStatus = async (user) => {
    if (currentAdminRole !== 'admin') return toast.error("⛔ 權限不足");
    const newStatus = user.status === 'suspended' ? 'active' : 'suspended';
    if (!window.confirm(`確定要將此帳戶設定為「${newStatus === 'suspended' ? '停權' : '正常'}」嗎？`)) return;
    try {
      await updateDoc(doc(db, "users", user.id), { status: newStatus });
      toast.success(`帳號已${newStatus === 'suspended' ? '停權' : '恢復正常'}`);
      fetchUsers();
    } catch(e) { toast.error("操作失敗"); }
  };

  const deleteUser = async (userId) => {
    if (currentAdminRole !== 'admin') return toast.error("⛔ 權限不足");
    if (!window.confirm("⚠️ 警告：這將徹底刪除該客人的所有資料！確定刪除？")) return;
    try {
      await deleteDoc(doc(db, "users", userId));
      toast.success("帳號已徹底刪除");
      fetchUsers();
    } catch(e) { toast.error("刪除失敗"); }
  };

  // ==========================================
  // 🟢 終極嚴格：階級視角邏輯 (Visibility Logic)
  // ==========================================
  const hierarchicalUsers = users.filter(u => {
    // 1. 老闆 (Admin)：看全部
    if (currentAdminRole === 'admin') return true;

    // 2. 永遠可以看到「自己」的檔案
    if (u.id === currentUid) return true;

    // 3. 經理 (Manager)：看所有下屬與客人 (不包含其他 Manager 與 Admin)
    if (currentAdminRole === 'manager') {
      return ['staff', 'reception', 'member'].includes(u.role);
    }

    // 4. 櫃台 / 員工：只能看客人 (不包含同級同事、Manager、Admin)
    if (['staff', 'reception'].includes(currentAdminRole)) {
      return ['member'].includes(u.role);
    }

    return false;
  });

  // 根據上方的「篩選按鈕」進行二次過濾
  const filteredUsers = filterRole === 'all' ? hierarchicalUsers : hierarchicalUsers.filter(u => u.role === filterRole);

  // 決定畫面上要顯示哪些篩選按鈕 (不能篩選自己沒權限看的角色)
  const getVisibleRoleButtons = () => {
    if (currentAdminRole === 'admin') return ['all', 'member', 'reception', 'staff', 'manager', 'admin'];
    if (currentAdminRole === 'manager') return ['all', 'member', 'reception', 'staff'];
    return ['all', 'member'];
  };

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

      {/* 動態顯示篩選按鈕 */}
      <div className="flex flex-wrap gap-3 mb-8">
        {getVisibleRoleButtons().map(role => (
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
                      {/* 標示「自己」 */}
                      {u.id === currentUid && <span className="ml-2 text-[8px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full uppercase tracking-widest border border-blue-500/30">You</span>}
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
                    {/* 鎖死：如果不是 Admin，這個下拉選單直接變灰且無法點擊 */}
                    <select 
                      value={u.role || 'member'} 
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      disabled={currentAdminRole !== 'admin'}
                      className={`bg-black border p-2 rounded-lg text-xs font-bold outline-none ${
                        currentAdminRole === 'admin' ? 'cursor-pointer hover:bg-white/10' : 'opacity-40 cursor-not-allowed'
                      } ${
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
                     {/* 防護：只有老闆可以停用和刪除帳號 */}
                     {currentAdminRole === 'admin' && (
                       <>
                         <button onClick={() => toggleUserStatus(u)} className={`text-[10px] px-4 py-2 rounded-xl font-bold uppercase tracking-widest transition ${u.status === 'suspended' ? 'bg-green-500/10 text-green-500 hover:bg-green-500 hover:text-white' : 'bg-orange-500/10 text-orange-500 hover:bg-orange-500 hover:text-white'}`}>
                           {u.status === 'suspended' ? '復權' : '停用'}
                         </button>
                         <button onClick={() => deleteUser(u.id)} className="text-[10px] bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white px-4 py-2 rounded-xl font-bold uppercase tracking-widest transition">
                           刪除
                         </button>
                       </>
                     )}
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

      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-6 backdrop-blur-sm">
          <div className="bg-[#121212] w-full max-w-lg rounded-[40px] p-10 border border-white/10 shadow-2xl relative">
            <button onClick={() => setIsCreateOpen(false)} className="absolute top-6 right-6 text-gray-500 hover:text-white"><i className="fa-solid fa-xmark text-xl"></i></button>
            <h2 className="text-2xl font-black text-white italic mb-8">Create <span className="text-[#D4AF37]">User</span></h2>
            
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">身分權限</label>
                {/* 防護：如果不是老闆，下拉選單強迫鎖定在 Member */}
                <select 
                  value={newUser.role} 
                  onChange={e => setNewUser({...newUser, role: e.target.value})} 
                  disabled={currentAdminRole !== 'admin'}
                  className={`w-full bg-black border border-[#D4AF37]/50 p-3 rounded-xl text-[#D4AF37] font-bold outline-none ${currentAdminRole !== 'admin' ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <option value="member">一般會員 (Member) - 無需密碼</option>
                  {currentAdminRole === 'admin' && (
                    <>
                      <option value="reception">櫃台人員 (Reception)</option>
                      <option value="staff">店內員工 / 髮型師 (Staff)</option>
                      <option value="manager">店鋪經理 (Manager)</option>
                      <option value="admin">系統管理員 (Admin)</option>
                    </>
                  )}
                </select>
                {currentAdminRole !== 'admin' && <p className="text-[9px] text-red-400 mt-1">您僅有權限建立客戶檔案。如需開通員工帳號，請聯繫老闆。</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">姓名 (必填)</label>
                  <input type="text" required value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} className="w-full bg-black border border-white/10 p-3 rounded-xl text-white outline-none focus:border-[#D4AF37]" placeholder="如: 陳大文 / Ivan" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">電話號碼</label>
                  <input type="text" value={newUser.phone} onChange={e => setNewUser({...newUser, phone: e.target.value})} className="w-full bg-black border border-white/10 p-3 rounded-xl text-white outline-none focus:border-[#D4AF37]" placeholder="+852..." />
                </div>
              </div>

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
                    <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">初始密碼 (最少6碼)</label>
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

      {/* 權限對照矩陣 Modal */}
      {isRoleMatrixOpen && (
        <div className="fixed inset-0 bg-black/95 z-[70] flex items-center justify-center p-6 backdrop-blur-md">
          <div className="bg-[#121212] w-full max-w-4xl rounded-[40px] p-6 md:p-10 border border-[#D4AF37]/30 shadow-[0_0_50px_rgba(212,175,55,0.1)] relative max-h-[90vh] overflow-y-auto custom-scrollbar">
            <button onClick={() => setIsRoleMatrixOpen(false)} className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors">
              <i className="fa-solid fa-xmark text-2xl"></i>
            </button>
            
            <div className="mb-8 border-b border-white/10 pb-6">
              <h2 className="text-3xl font-black text-white italic tracking-tighter">Role <span className="text-[#D4AF37]">Permissions</span></h2>
              <p className="text-xs text-gray-400 mt-2 tracking-widest">各級職務系統存取權限對照表 (嚴格階級隔離)</p>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[10px] text-gray-500 uppercase tracking-widest border-b border-white/10 bg-white/5">
                    <th className="p-4 font-bold w-1/4">系統功能 / 模組</th>
                    <th className="p-4 font-bold text-center border-l border-white/5 text-[#D4AF37]">老闆 (Admin)</th>
                    <th className="p-4 font-bold text-center border-l border-white/5 text-purple-400">經理 (Manager)</th>
                    <th className="p-4 font-bold text-center border-l border-white/5 text-green-400">櫃台 (Reception)</th>
                    <th className="p-4 font-bold text-center border-l border-white/5 text-blue-400">髮型師 (Staff)</th>
                  </tr>
                </thead>
                <tbody className="text-sm font-medium">
                  <tr className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="p-4 text-gray-300">前台 POS 收銀 / 報到</td>
                    <td className="p-4 text-center border-l border-white/5 text-green-500"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-green-500"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-green-500"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-gray-600"><i className="fa-solid fa-minus"></i></td>
                  </tr>
                  <tr className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="p-4 text-gray-300">門市客席增值 / 賣套票</td>
                    <td className="p-4 text-center border-l border-white/5 text-green-500"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-green-500"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-green-500"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-gray-600"><i className="fa-solid fa-minus"></i></td>
                  </tr>
                  <tr className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="p-4 text-gray-300">查看個人業績 / 抽成</td>
                    <td className="p-4 text-center border-l border-white/5 text-green-500">全店</td>
                    <td className="p-4 text-center border-l border-white/5 text-green-500">全店</td>
                    <td className="p-4 text-center border-l border-white/5 text-gray-600"><i className="fa-solid fa-minus"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-green-500">僅限自己</td>
                  </tr>
                  <tr className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="p-4 text-gray-300">新增客戶檔案 (Member)</td>
                    <td className="p-4 text-center border-l border-white/5 text-green-500"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-green-500"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-green-500"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-gray-600"><i className="fa-solid fa-minus"></i></td>
                  </tr>
                  <tr className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="p-4 text-gray-300">修改 CMS 價目表 / 促銷</td>
                    <td className="p-4 text-center border-l border-white/5 text-green-500"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-green-500"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark text-red-500"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark text-red-500"></i></td>
                  </tr>
                  <tr className="border-b border-white/5 hover:bg-white/[0.02] bg-red-900/10">
                    <td className="p-4 text-red-300 font-bold">手動派發積分 / T-Dollar</td>
                    <td className="p-4 text-center border-l border-white/5 text-green-500"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark text-red-500"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark text-red-500"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark text-red-500"></i></td>
                  </tr>
                  <tr className="border-b border-white/5 hover:bg-white/[0.02] bg-red-900/10">
                    <td className="p-4 text-red-300 font-bold">設定員工底薪與抽成參數</td>
                    <td className="p-4 text-center border-l border-white/5 text-green-500"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark text-red-500"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark text-red-500"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark text-red-500"></i></td>
                  </tr>
                  <tr className="border-b border-white/5 hover:bg-white/[0.02] bg-red-900/10">
                    <td className="p-4 text-red-300 font-bold">更改他人系統權限</td>
                    <td className="p-4 text-center border-l border-white/5 text-green-500"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark text-red-500"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark text-red-500"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark text-red-500"></i></td>
                  </tr>
                  <tr className="border-b border-white/5 hover:bg-white/[0.02] bg-red-900/10">
                    <td className="p-4 text-red-300 font-bold">輸出全系統資料庫備份</td>
                    <td className="p-4 text-center border-l border-white/5 text-green-500"><i className="fa-solid fa-check"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark text-red-500"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark text-red-500"></i></td>
                    <td className="p-4 text-center border-l border-white/5 text-gray-600"><i className="fa-solid fa-xmark text-red-500"></i></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-8 bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-start gap-3">
              <i className="fa-solid fa-shield-halved text-red-400 mt-0.5"></i> 
              <p className="text-xs text-red-400 tracking-widest leading-relaxed">
                <strong>安全性隔離機制：</strong> <br/>
                系統已自動阻擋越權行為。同級別員工無法互相查閱薪資；櫃台人員無法修改設定；唯有使用老闆 (Admin) 帳號登入，方可解鎖紅色底色的所有機密級操作。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 用戶詳情 Modal */}
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
              
              {/* 🟢 系統資產手動調整區塊 (僅限老闆) */}
              {currentAdminRole === 'admin' && (
                <div className="bg-gradient-to-r from-red-900/20 to-black p-6 rounded-3xl border border-red-500/30 shadow-lg">
                  <h3 className="text-[10px] font-bold text-red-400 uppercase tracking-[0.4em] mb-4 flex items-center gap-2">
                    <i className="fa-solid fa-wand-magic-sparkles"></i> 系統資產手動調整 (Admin Only)
                  </h3>
                  <form onSubmit={handleAssetAdjustment} className="space-y-4">
                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] text-gray-400 uppercase tracking-widest ml-1">發放/扣除 積分 (正/負數)</label>
                          <input type="number" value={adjustForm.points} onChange={e => setAdjustForm({...adjustForm, points: e.target.value})} className="w-full bg-black border border-red-500/30 p-3 rounded-xl text-white outline-none focus:border-red-500 text-sm font-mono" placeholder="如：+500 或 -100" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-gray-400 uppercase tracking-widest ml-1">發放/扣除 T-Dollar (正/負數)</label>
                          <input type="number" value={adjustForm.tDollar} onChange={e => setAdjustForm({...adjustForm, tDollar: e.target.value})} className="w-full bg-black border border-red-500/30 p-3 rounded-xl text-white outline-none focus:border-red-500 text-sm font-mono" placeholder="如：+1000 或 -500" />
                        </div>
                     </div>
                     <div className="space-y-1">
                        <label className="text-[10px] text-gray-400 uppercase tracking-widest ml-1">調整備註 (必填，將顯示於報表)</label>
                        <input type="text" required value={adjustForm.note} onChange={e => setAdjustForm({...adjustForm, note: e.target.value})} className="w-full bg-black border border-red-500/30 p-3 rounded-xl text-white outline-none focus:border-red-500 text-sm" placeholder="如：註冊大禮包發放、客訴補償餘額..." />
                     </div>
                     <button type="submit" className="w-full bg-red-500 text-white font-bold py-3 rounded-xl text-xs uppercase tracking-widest hover:bg-red-600 transition-colors shadow-lg">
                        執行調整並寫入交易紀錄
                     </button>
                  </form>
                </div>
              )}

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
