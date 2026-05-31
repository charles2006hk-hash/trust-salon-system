"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, getDocs, doc, updateDoc, addDoc, setDoc, query, where, deleteDoc, getDoc, runTransaction } from 'firebase/firestore'; 
import { onAuthStateChanged, sendPasswordResetEmail } from 'firebase/auth'; 
import { Toaster, toast } from 'react-hot-toast';

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState('all');
  
  const [searchQuery, setSearchQuery] = useState('');

  const [currentAdminRole, setCurrentAdminRole] = useState('reception'); 
  const [currentUid, setCurrentUid] = useState(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  // 🟢 新增用戶狀態：加入預設店鋪 branch: 'all'
  const [newUser, setNewUser] = useState({ name: '', phone: '', email: '', password: '', role: 'member', tDollar: 0, points: 0, branch: 'all' });

  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [staffStats, setStaffStats] = useState({ clientCount: 0, revenue: 0 });
  const [isSaving, setIsSaving] = useState(false);

  const [adjustForm, setAdjustForm] = useState({ points: '', tDollar: '', note: '' });
  
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [isRoleMatrixOpen, setIsRoleMatrixOpen] = useState(false);

  // 🟢 舊帳號數據遷移專用狀態
  const [migratePhone, setMigratePhone] = useState('');
  const [migratePassword, setMigratePassword] = useState('');
  const [migrateBranch, setMigrateBranch] = useState('all');

  const MASTER_EMAIL = "trustsalon.taipo@gmail.com";

  useEffect(() => {
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
      let loginEmail = newUser.email; 

      if (newUser.role !== 'member') {
        if (currentAdminRole !== 'admin') {
           return toast.error("權限不足：只有老闆 (Admin) 可以建立內部員工帳號", { id: toastId });
        }
        
        const cleanPhone = newUser.phone.replace(/[^0-9]/g, '');
        if (!cleanPhone || cleanPhone.length < 8) {
          return toast.error("建立員工帳號必須填寫有效的電話號碼 (至少 8 碼) 作為登入憑證！", { id: toastId });
        }
        if (!newUser.password || newUser.password.length < 6) {
          return toast.error("初始密碼必須至少 6 個字元", { id: toastId });
        }
        
        loginEmail = MASTER_EMAIL.replace('@', `+${cleanPhone}@`);
        
        const apiKey = auth.app.options.apiKey;
        const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: loginEmail,
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
        email: loginEmail || '', 
        role: newUser.role,
        tDollarBalance: Number(newUser.tDollar),
        points: Number(newUser.points),
        packageBalances: {},
        createdAt: new Date().toISOString(),
        status: 'active',
        notes: '',
        isFirstLogin: true, // 🟢 確保新帳號觸發攔截
        branch: newUser.branch || 'all' // 🟢 寫入所屬店鋪
      };

      if (finalUid) {
        await setDoc(doc(db, "users", finalUid), userData);
        toast.success(`員工帳號建立成功！\n登入電話：${newUser.phone}\n登入密碼：${newUser.password}`, { id: toastId, duration: 6000 });
      } else {
        await addDoc(collection(db, "users"), userData);
        toast.success("客戶檔案建立成功！可進入 Details 派發註冊禮積分。", { id: toastId });
      }

      setIsCreateOpen(false);
      setNewUser({ name: '', phone: '', email: '', password: '', role: 'member', tDollar: 0, points: 0, branch: 'all' });
      fetchUsers();
      
    } catch (error) {
      let errMsg = "建立失敗";
      if (error.message.includes('EMAIL_EXISTS')) errMsg = "此電話號碼已經被註冊過系統帳號了";
      toast.error(errMsg, { id: toastId });
    }
  };

  const openDetails = async (user) => {
    setSelectedUser(user);
    setAdjustForm({ points: '', tDollar: '', note: '' }); 
    setMigratePhone(user.phoneNumber || ''); 
    setMigratePassword(''); 
    setMigrateBranch(user.branch || 'all');
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

  const handleMigrateOldUser = async (e) => {
    e.preventDefault();
    if (currentAdminRole !== 'admin') return toast.error("⛔ 權限不足：僅限最高管理員老闆操作");
    
    const cleanPhone = migratePhone.replace(/[^0-9]/g, '');
    if (!cleanPhone || cleanPhone.length < 8) return toast.error("請輸入有效的 8 位數手機號碼作為登入帳號");
    if (!migratePassword || migratePassword.length < 6) return toast.error("初始密碼長度至少需要 6 個字元");

    const toastId = toast.loading(`正在將【${selectedUser.name}】的業績、套票與資產轉移至新電話憑證...`);
    try {
      const loginEmail = MASTER_EMAIL.replace('@', `+${cleanPhone}@`);

      const apiKey = auth.app.options.apiKey;
      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: migratePassword, returnSecureToken: false })
      });
      const authData = await response.json();
      if (!response.ok) throw new Error(authData.error.message || "建立新認證憑證失敗");
      const newUid = authData.localId;

      const { id, ...oldDataWithoutId } = selectedUser; 
      const migratedData = {
        ...oldDataWithoutId,
        phoneNumber: migratePhone,
        email: loginEmail,
        isFirstLogin: true, 
        branch: migrateBranch // 🟢 同步遷移店鋪資料
      };

      await setDoc(doc(db, "users", newUid), migratedData);
      await deleteDoc(doc(db, "users", selectedUser.id));

      toast.success(`🎉 舊帳號【${selectedUser.name}】手機格式升級成功！\n歷史業績與資產已 100% 完美遷移。`, { id: toastId, duration: 6000 });
      setIsDetailOpen(false);
      fetchUsers();
    } catch (error) {
      let errMsg = error.message;
      if (errMsg.includes("EMAIL_EXISTS")) errMsg = "此手機號碼已被系統內的其他員工佔用了！";
      toast.error(errMsg, { id: toastId });
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
        branch: selectedUser.branch || 'all', // 🟢 儲存店鋪設定
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

  const handleSendResetEmail = async (e) => {
    e.preventDefault();
    if (currentAdminRole !== 'admin') return toast.error("⛔ 權限不足：僅限老闆操作");
    if (!selectedUser.email) return toast.error("此帳號沒有綁定登入憑證，無法發送重設信件！");

    if (!window.confirm(`確定要發送密碼重設信嗎？\n(信件將發送至母信箱：${MASTER_EMAIL}，由老闆代為修改)`)) return;

    setIsResettingPassword(true);
    const toastId = toast.loading("正在發送安全重設信件...");

    try {
      await sendPasswordResetEmail(auth, selectedUser.email);
      toast.success(`✅ 重設信已成功發送至母信箱：\n${MASTER_EMAIL}\n請前往信箱點擊連結並輸入新密碼。`, { id: toastId, duration: 8000 });
    } catch (error) {
      toast.error("發送失敗，請確認該帳號是否已開通系統登入權限。", { id: toastId });
    } finally {
      setIsResettingPassword(false);
    }
  };

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
        
        tx.set(doc(collection(db, "transactions")), {
          userId: selectedUser.id, 
          phoneNumber: selectedUser.phoneNumber || '未提供號碼', 
          type: "admin_adjustment",
          pointsAdded: pts, 
          tDollarAdded: td, 
          adminId: currentUid, 
          note: adjustForm.note || '老闆手動調整', 
          timestamp: new Date().toISOString()
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

  const hierarchicalUsers = users.filter(u => {
    if (currentAdminRole === 'admin') return true;
    if (u.id === currentUid) return true;
    if (currentAdminRole === 'manager') return ['staff', 'reception', 'member'].includes(u.role);
    if (['staff', 'reception'].includes(currentAdminRole)) return ['member'].includes(u.role);
    return false;
  });

  const roleFilteredUsers = filterRole === 'all' ? hierarchicalUsers : hierarchicalUsers.filter(u => u.role === filterRole);

  const finalFilteredUsers = roleFilteredUsers.filter(u => {
    if (!searchQuery) return true;
    const lowerQuery = searchQuery.toLowerCase();
    const nameMatch = u.name ? u.name.toLowerCase().includes(lowerQuery) : false;
    const phoneMatch = u.phoneNumber ? u.phoneNumber.includes(lowerQuery) : false;
    return nameMatch || phoneMatch;
  });

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

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div className="flex flex-wrap gap-2">
          {getVisibleRoleButtons().map(role => (
            <button key={role} onClick={() => setFilterRole(role)}
              className={`px-5 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all border ${filterRole === role ? 'bg-[#D4AF37] text-black border-[#D4AF37]' : 'bg-transparent text-gray-500 border-gray-800 hover:border-gray-500'}`}>
              {role === 'all' ? '全部' : role}
            </button>
          ))}
        </div>
        
        <div className="w-full md:w-72 relative">
          <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">
             <i className="fa-solid fa-magnifying-glass text-gray-500"></i>
          </div>
          <input 
            type="text" 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#121212] border border-white/10 p-3 pl-10 rounded-full text-white outline-none focus:border-[#D4AF37] text-sm transition-colors shadow-inner" 
            placeholder="搜尋姓名或電話號碼..." 
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute inset-y-0 right-0 flex items-center pr-4 text-gray-500 hover:text-white transition-colors">
              <i className="fa-solid fa-circle-xmark"></i>
            </button>
          )}
        </div>
      </div>

      <div className="bg-[#121212] rounded-[32px] border border-white/5 overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-gray-500 uppercase tracking-widest border-b border-white/5 bg-black/20">
                <th className="p-6 font-bold">姓名與識別資訊</th>
                <th className="p-6 font-bold">所屬店鋪</th>
                <th className="p-6 font-bold">資產狀態</th>
                <th className="p-6 font-bold">系統權限 (Role)</th>
                <th className="p-6 font-bold text-right">操作</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {finalFilteredUsers.map(u => (
                <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                  <td className="p-6">
                    <p className="text-white font-bold text-base mb-1 flex items-center gap-2">
                      {u.name || '未設定姓名'} 
                      {u.role === 'admin' && <i className="fa-solid fa-crown text-[#D4AF37] text-xs"></i>}
                      {['staff', 'manager'].includes(u.role) && <i className="fa-solid fa-scissors text-[#D4AF37] text-xs"></i>}
                      {u.role === 'reception' && <i className="fa-solid fa-desktop text-blue-400 text-xs"></i>}
                      {u.id === currentUid && <span className="ml-2 text-[8px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full uppercase tracking-widest border border-blue-500/30">You</span>}
                    </p>
                    <p className="text-[10px] text-gray-500 font-mono tracking-widest">{u.phoneNumber || u.email || '無綁定聯絡方式'}</p>
                  </td>
                  {/* 🟢 列表清爽顯示所屬分店標籤 */}
                  <td className="p-6">
                    <span className={`text-[9px] px-2 py-1 rounded font-bold tracking-widest uppercase ${u.branch === 'taipo' ? 'bg-orange-500/20 text-orange-400' : u.branch === 'lokfu' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}>
                      {u.branch === 'taipo' ? '大埔店' : u.branch === 'lokfu' ? '樂富店' : '全域管理'}
                    </span>
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
              {finalFilteredUsers.length === 0 && (
                <tr>
                  <td colSpan="5" className="p-10 text-center text-gray-500 font-bold tracking-widest border border-dashed border-white/5">
                    {searchQuery ? `找不到符合「${searchQuery}」的用戶資料` : '此分類目前沒有用戶資料'}
                  </td>
                </tr>
              )}
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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">身分權限</label>
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
                  {currentAdminRole !== 'admin' && <p className="text-[9px] text-red-400 mt-1">您僅有權限建立客戶檔案。</p>}
                </div>

                {/* 🟢 選擇所屬分店 */}
                <div className="space-y-1">
                  <label className="text-[10px] text-[#D4AF37] font-bold uppercase tracking-widest">所屬分店 (Branch)</label>
                  <select 
                    value={newUser.branch} 
                    onChange={e => setNewUser({...newUser, branch: e.target.value})} 
                    className="w-full bg-black border border-[#D4AF37]/40 p-3 rounded-xl text-[#D4AF37] text-sm font-bold outline-none"
                  >
                    <option value="all">🌐 全域通 (All)</option>
                    <option value="taipo">✂️ 大埔店 (Tai Po)</option>
                    <option value="lokfu">🎨 樂富店 (Lok Fu)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">姓名 (必填)</label>
                  <input type="text" required value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} className="w-full bg-black border border-white/10 p-3 rounded-xl text-white outline-none focus:border-[#D4AF37]" placeholder="如: 陳大文 / Ivan" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-[#D4AF37] font-bold uppercase tracking-widest">{newUser.role !== 'member' ? '登入電話號碼 (必填)' : '電話號碼'}</label>
                  <input type="tel" required={newUser.role !== 'member'} value={newUser.phone} onChange={e => setNewUser({...newUser, phone: e.target.value})} className={`w-full bg-black border p-3 rounded-xl text-white outline-none focus:border-[#D4AF37] ${newUser.role !== 'member' ? 'border-[#D4AF37]/50' : 'border-white/10'}`} placeholder="輸入完整號碼..." />
                </div>
              </div>

              {newUser.role !== 'member' && (
                <div className="grid grid-cols-1 gap-4 animate-fade-in border-t border-white/10 pt-4 mt-2">
                  <div className="space-y-1">
                    <p className="text-xs text-[#D4AF37] mb-2 font-bold"><i className="fa-solid fa-lock"></i> 內部人員登入憑證設定</p>
                    <p className="text-[10px] text-gray-400 bg-white/5 p-2 rounded-lg leading-relaxed">
                      💡 系統將自動綁定<strong>「電話號碼」</strong>作為該員工的登入帳號。<br/>
                      請在下方設定初始密碼，建立後請員工以<strong>「電話號碼 + 密碼」</strong>登入系統即可。
                    </p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">初始登入密碼 (最少6碼)</label>
                    <input type="text" required={newUser.role !== 'member'} minLength={6} value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} className="w-full bg-black border border-[#D4AF37]/50 p-3 rounded-xl text-white outline-none focus:border-[#D4AF37]" placeholder="如: 123456" />
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

      {/* 🟢 用戶細節彈窗 */}
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
              
              {/* 🟢 舊帳號手機升級器：加入所屬分店選擇 */}
              {currentAdminRole === 'admin' && selectedUser.role !== 'member' && (!selectedUser.phoneNumber || (selectedUser.email && !selectedUser.email.includes('+'))) && (
                <div className="bg-blue-950/40 p-6 rounded-3xl border border-blue-500/40 shadow-lg animate-fade-in">
                  <h3 className="text-[10px] font-black text-blue-400 uppercase tracking-[0.4em] mb-3 flex items-center gap-2">
                    <i className="fa-solid fa-rocket animate-pulse"></i> 舊帳號手機升級器 (One-Click Migration)
                  </h3>
                  <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                    系統偵測到此檔案為舊版本格式。請在下方輸入該員工的<strong>「真實電話號碼」</strong>並設定初始密碼，系統會自動開通電話影子登入，並將她原本的<strong>所有服務客數、業績產值、套票餘額、T-Dollar、Points 所有數據完美移轉</strong>！
                  </p>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">員工真實電話號碼</label>
                      <input type="tel" value={migratePhone} onChange={e => setMigratePhone(e.target.value)} className="w-full bg-black border border-blue-500/20 p-3 rounded-xl text-white outline-none focus:border-blue-400 text-sm font-mono placeholder:text-gray-700" placeholder="如: 98765432" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">設定臨時密碼</label>
                      <input type="text" value={migratePassword} onChange={e => setMigratePassword(e.target.value)} className="w-full bg-black border border-blue-500/20 p-3 rounded-xl text-white outline-none focus:border-blue-400 text-sm placeholder:text-gray-700" placeholder="如: 123456" />
                    </div>
                    {/* 🟢 遷移時指定分店 */}
                    <div className="space-y-1">
                      <label className="text-[10px] text-[#D4AF37] font-bold uppercase tracking-widest">指定所屬分店</label>
                      <select value={migrateBranch} onChange={e => setMigrateBranch(e.target.value)} className="w-full bg-black border border-[#D4AF37]/30 p-3 rounded-xl text-[#D4AF37] text-sm font-bold outline-none">
                        <option value="all">全域通</option>
                        <option value="taipo">大埔店</option>
                        <option value="lokfu">樂富店</option>
                      </select>
                    </div>
                  </div>
                  <button type="button" onClick={handleMigrateOldUser} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-3 rounded-xl text-xs uppercase tracking-widest transition-all shadow-md active:scale-95">
                    執行一鍵數據移轉 ＆ 升級手機憑證
                  </button>
                </div>
              )}

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
                      <p className="text-[10px] text-[#D4AF37] uppercase tracking-widest mb-1">創造總業績 (Revenue)</p>
                      <p className="text-3xl font-black text-[#D4AF37]"><span className="text-sm mr-1">$</span>{staffStats.revenue.toLocaleString()}</p>
                    </div>
                  </div>
                  
                  <div className="mt-4 bg-blue-500/10 border border-blue-500/20 p-3 rounded-xl">
                     <p className="text-[10px] text-blue-400 leading-relaxed">
                       💡 <strong>溫馨提示：</strong>此處僅顯示基礎服務客數與總產值。<br/>如需查看詳細的<strong>「實得抽成與獎金明細」</strong>，請前往左側選單的<strong>「財務報表」</strong>查看個人薪資單。
                     </p>
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
                  
                  {/* 🟢 詳情頁：老闆可隨時修改員工所屬分店 */}
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] text-[#D4AF37] font-bold uppercase tracking-widest ml-1">修改所屬店鋪 (Branch)</label>
                    <select 
                      value={selectedUser.branch || 'all'} 
                      onChange={e => setSelectedUser({...selectedUser, branch: e.target.value})} 
                      className="w-full bg-black border border-white/5 p-4 rounded-xl text-[#D4AF37] font-bold text-sm outline-none focus:border-[#D4AF37]"
                    >
                      <option value="all">🌐 全域管理 (All Branches)</option>
                      <option value="taipo">✂️ 大埔店 (Tai Po Salon)</option>
                      <option value="lokfu">🎨 樂富店 (Lok Fu Salon)</option>
                    </select>
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest ml-1">系統認證信箱 (登入憑證)</label>
                    <input type="email" disabled value={selectedUser.email || '早期未綁定憑證之帳號'} className="w-full bg-black border border-white/5 p-4 rounded-xl text-gray-500 outline-none text-sm font-mono opacity-50 cursor-not-allowed" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] text-gray-500 font-bold uppercase tracking-widest ml-1">管理員備註 (Notes)</label>
                    <textarea value={selectedUser.notes || ''} onChange={e => setSelectedUser({...selectedUser, notes: e.target.value})} className="w-full bg-black border border-white/5 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37] text-sm h-24" placeholder="例如：VIP 客戶喜好、員工入職日期..." />
                  </div>
                </div>
              </div>

              <div className="flex gap-4 pt-4 border-t border-white/5 pb-4">
                <button onClick={() => setIsDetailOpen(false)} className="flex-1 bg-white/5 text-white font-bold py-4 rounded-xl uppercase tracking-widest text-xs hover:bg-white/10 transition-all">取消</button>
                <button onClick={saveUserDetails} disabled={isSaving} className="flex-1 bg-[#D4AF37] text-black font-black py-4 rounded-xl uppercase tracking-widest text-xs hover:scale-105 transition-transform disabled:opacity-50">
                  {isSaving ? '儲存中...' : '💾 儲存修改'}
                </button>
              </div>

              {/* 🟢 影子信箱：完美發送重設信件至老闆母信箱 */}
              {currentAdminRole === 'admin' && selectedUser.role !== 'member' && selectedUser.email && selectedUser.email.includes('+') && (
                <div className="bg-red-900/10 p-6 rounded-3xl border border-red-500/30">
                  <h3 className="text-[10px] font-bold text-red-400 uppercase tracking-[0.4em] mb-4 flex items-center gap-2">
                    <i className="fa-solid fa-lock"></i> 密碼安全性設定 (Admin Only)
                  </h3>
                  <button 
                    onClick={handleSendResetEmail}
                    disabled={isResettingPassword || !selectedUser.email}
                    className="bg-red-500 hover:bg-red-600 text-white font-bold px-6 py-3 rounded-xl text-xs uppercase tracking-widest transition-colors shadow-lg disabled:opacity-50 w-full"
                  >
                    {isResettingPassword ? '發送中...' : '✉️ 發送密碼重設信件至系統母信箱'}
                  </button>
                  <p className="text-[9px] text-gray-500 mt-3 leading-relaxed">💡 點擊後，重設密碼信件將直接寄送至 <strong>{MASTER_EMAIL}</strong>。<br/>請老闆前往該信箱收信，點擊連結後即可代為設定該員工的新密碼。</p>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* 🟢 毫不保留：完整還原你的權限矩陣表 (Role Matrix Modal) */}
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
