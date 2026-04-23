"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, updateDoc, setDoc, getDoc } from 'firebase/firestore'; 
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Toaster, toast } from 'react-hot-toast';

export default function AdminManagePage() {
  const [activeTab, setActiveTab] = useState('services'); 
  const [list, setList] = useState([]);
  const [categories, setCategories] = useState([]); 
  const [packagesList, setPackagesList] = useState([]); 
  const [templatesList, setTemplatesList] = useState([]); 
  const [branchesList, setBranchesList] = useState([]); 
  
  const [registeredStaff, setRegisteredStaff] = useState([]); 
  const [isCustomStaff, setIsCustomStaff] = useState(false);

  const [loading, setLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(true); 
  const [currentUserRole, setCurrentUserRole] = useState(null); 

  const [editingId, setEditingId] = useState(null);
  
  // 🟢 新增：控制摺疊面板的狀態
  const [expandedGroups, setExpandedGroups] = useState({});
  const router = useRouter();

  // 🟢 加入預設標籤對照表 (支援 R3)
  const defaultLabels = {
    W1: '洗剪吹類 (需扣耗材)', W2: '洗剪吹類 (純抽成)', W3: '洗剪吹類 (高階)', 
    R1: '染燙化學類 (需扣耗材)', R2: '染燙化學類 (純抽成)', R3: '染燙化學類 (進階)', 
    P1: '產品實體 (預設 A級抽 20%)', P2: '產品實體 (預設 A級抽 25%)', P3: '產品實體 (預設 A級抽 18%)', P4: '產品實體 (預設 A級抽 15%)', P5: '產品實體 (預設 A級抽 35%)', 
    SCALP: '頭皮/養護套票類'
  };
  const [globalLabels, setGlobalLabels] = useState(defaultLabels);

  const defaultCommissions = {
    W1: { deduct: 0, percent: 0 }, W2: { deduct: 0, percent: 0 }, W3: { deduct: 0, percent: 0 },
    R1: { deduct: 0, percent: 0 }, R2: { deduct: 0, percent: 0 }, R3: { deduct: 0, percent: 0 },
    P1: { deduct: 0, percent: 0 }, P2: { deduct: 0, percent: 0 }, P3: { deduct: 0, percent: 0 }, 
    P4: { deduct: 0, percent: 0 }, P5: { deduct: 0, percent: 0 }, SCALP: { deduct: 0, percent: 0 }
  };

  const defaultPresets = {
    "A 級師傅": { W1: { deduct: 20, percent: 35 }, W2: { deduct: 0, percent: 28 }, W3: { deduct: 0, percent: 32 }, R1: { deduct: 0, percent: 60 }, R2: { deduct: 0, percent: 0 }, R3: { deduct: 0, percent: 0 }, P1: { deduct: 0, percent: 20 }, P2: { deduct: 0, percent: 25 }, P3: { deduct: 0, percent: 18 }, P4: { deduct: 0, percent: 15 }, P5: { deduct: 0, percent: 35 }, SCALP: { deduct: 0, percent: 25 } },
    "B 級師傅": { W1: { deduct: 20, percent: 35 }, W2: { deduct: 0, percent: 24.5 }, W3: { deduct: 0, percent: 28 }, R1: { deduct: 20, percent: 50 }, R2: { deduct: 0, percent: 35 }, R3: { deduct: 0, percent: 0 }, P1: { deduct: 0, percent: 20 }, P2: { deduct: 0, percent: 25 }, P3: { deduct: 0, percent: 18 }, P4: { deduct: 0, percent: 15 }, P5: { deduct: 0, percent: 35 }, SCALP: { deduct: 0, percent: 25 } },
    "C 級師傅": { W1: { deduct: 20, percent: 35 }, W2: { deduct: 0, percent: 22.75 }, W3: { deduct: 0, percent: 26.25 }, R1: { deduct: 20, percent: 50 }, R2: { deduct: 0, percent: 32.5 }, R3: { deduct: 0, percent: 0 }, P1: { deduct: 0, percent: 20 }, P2: { deduct: 0, percent: 25 }, P3: { deduct: 0, percent: 18 }, P4: { deduct: 0, percent: 15 }, P5: { deduct: 0, percent: 35 }, SCALP: { deduct: 0, percent: 25 } },
    "D 級師傅": { W1: { deduct: 20, percent: 35 }, W2: { deduct: 0, percent: 24.5 }, W3: { deduct: 0, percent: 28 }, R1: { deduct: 0, percent: 50 }, R2: { deduct: 0, percent: 0 }, R3: { deduct: 0, percent: 0 }, P1: { deduct: 0, percent: 35 }, P2: { deduct: 0, percent: 35 }, P3: { deduct: 0, percent: 35 }, P4: { deduct: 0, percent: 35 }, P5: { deduct: 0, percent: 35 }, SCALP: { deduct: 0, percent: 25 } },
    "E 級助理": { W1: { deduct: 0, percent: 70 }, W2: { deduct: 0, percent: 70 }, W3: { deduct: 0, percent: 70 }, R1: { deduct: 0, percent: 70 }, R2: { deduct: 0, percent: 70 }, R3: { deduct: 0, percent: 70 }, P1: { deduct: 0, percent: 10 }, P2: { deduct: 0, percent: 10 }, P3: { deduct: 0, percent: 10 }, P4: { deduct: 0, percent: 10 }, P5: { deduct: 0, percent: 10 }, SCALP: { deduct: 0, percent: 10 } },
    "F 級助理": { W1: { deduct: 0, percent: 70 }, W2: { deduct: 0, percent: 60 }, W3: { deduct: 0, percent: 60 }, R1: { deduct: 0, percent: 70 }, R2: { deduct: 0, percent: 60 }, R3: { deduct: 0, percent: 60 }, P1: { deduct: 0, percent: 10 }, P2: { deduct: 0, percent: 10 }, P3: { deduct: 0, percent: 10 }, P4: { deduct: 0, percent: 10 }, P5: { deduct: 0, percent: 10 }, SCALP: { deduct: 0, percent: 10 } }
  };

  const initialForm = { 
    name: '', price: '', category: '', title: '', content: '', 
    expiry: '', points: '', icon: '', tag: '', threshold: '', discount: '', 
    quantity: '', upgradeBonus: '', giftPackageName: '', validityDays: 365,
    commissionCode: 'W1', templateId: '', templateName: '', commissions: defaultCommissions, branch: '',
    phoneNumber: '+852', commissionLabels: defaultLabels
  };
  const [formData, setFormData] = useState(initialForm);

  const promoEmojiList = ['🎁', '🔥', '✨', '📢', '📅', '🎉', '⚡', '🏆'];
  const salonEmojiList = ['🧴', '💆‍♀️', '💆‍♂️', '✂️', '✨', '💧', '🌿', '👑', '🎀', '💅', '🛍️', '🎁'];

  const menuGroups = [
    { title: "🛍️ 營運與商品定價", items: [{ id: 'services', label: '服務定價', icon: '💇‍♂️' }, { id: 'categories', label: '分類設定', icon: '🏷️' }, { id: 'packages', label: '套票與次數券', icon: '🎫' }] },
    { title: "👑 會員與行銷模組", items: [{ id: 'tiers', label: '會員等級與升級', icon: '👑' }, { id: 'rewards', label: '積分換領商城', icon: '🎁' }, { id: 'promos', label: '前台網頁公告', icon: '📢' }] },
    { title: "⚙️ 系統與全局設定", items: [{ id: 'branches', label: '門店管理', icon: '📍' }, { id: 'staff', label: '髮型師與專屬拆帳', icon: '✂️' }, { id: 'templates', label: '抽成模板管理', icon: '💰' }, { id: 'settings', label: '系統全局參數', icon: '⚙️' }] } 
  ];

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) return router.push('/login');
      try {
        const docSnap = await getDoc(doc(db, 'users', user.uid));
        if (docSnap.exists()) {
          const role = docSnap.data().role;
          setCurrentUserRole(role);
          if (['member', 'reception', 'staff'].includes(role)) {
            toast.error("⛔ 權限不足：您無法進入 CMS 管理中心");
            router.push(role === 'member' ? '/dashboard' : '/admin/pos');
            return;
          }
        }
      } catch (error) { console.error(error); } finally { setAuthLoading(false); }
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (currentUserRole && !['member', 'reception', 'staff'].includes(currentUserRole)) {
       fetchData(); fetchCategories(); fetchPackages(); fetchTemplates(); fetchRegisteredStaff(); fetchBranches(); fetchSettingsConfig();
       setExpandedGroups({}); // 🟢 切換 Tab 時重置摺疊狀態
    }
  }, [activeTab, currentUserRole]);

  const fetchSettingsConfig = async () => {
    try {
      const snap = await getDoc(doc(db, 'settings', 'global_config'));
      if (snap.exists() && snap.data().commissionLabels) {
        setGlobalLabels(snap.data().commissionLabels);
      }
    } catch(e) {}
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, activeTab));
      const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      if (activeTab === 'tiers') data.sort((a, b) => Number(b.threshold) - Number(a.threshold));
      
      if (activeTab === 'settings') {
        const settingsDoc = data.find(d => d.id === 'global_config');
        if (settingsDoc) {
          setFormData({...initialForm, validityDays: settingsDoc.validityDays || 365, commissionLabels: settingsDoc.commissionLabels || defaultLabels});
        } else {
          setFormData({...initialForm, validityDays: 365, commissionLabels: defaultLabels, name: '全局系統參數'});
        }
      }
      setList(data);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  const fetchCategories = async () => {
    try {
      const snap = await getDocs(collection(db, 'categories'));
      setCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch(e) { console.error(e); }
  };

  const fetchPackages = async () => {
    try {
      const snap = await getDocs(collection(db, 'packages'));
      setPackagesList(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch(e) { console.error(e); }
  };

  const fetchTemplates = async () => {
    try {
      const snap = await getDocs(collection(db, 'templates'));
      setTemplatesList(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch(e) { console.error(e); }
  };

  const fetchBranches = async () => {
    try {
      const snap = await getDocs(collection(db, 'branches'));
      setBranchesList(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch(e) { console.error(e); }
  };

  const fetchRegisteredStaff = async () => {
    try {
      const snap = await getDocs(collection(db, 'users'));
      const staffNames = snap.docs
        .map(doc => doc.data())
        .filter(u => ['staff', 'manager'].includes(u.role) && u.name)
        .map(u => u.name);
      setRegisteredStaff([...new Set(staffNames)]);
    } catch (e) { console.error(e); }
  };

  const initDefaultTemplates = async () => {
    setLoading(true);
    const toastId = toast.loading("正在為您強制更新預設抽成模板...");
    try {
      for (const [name, comms] of Object.entries(defaultPresets)) {
        const existing = templatesList.find(t => t.name === name);
        if (existing) {
          await updateDoc(doc(db, 'templates', existing.id), { commissions: comms, updatedAt: new Date().toISOString() });
        } else {
          await addDoc(collection(db, 'templates'), { name: name, commissions: comms, createdAt: new Date().toISOString() });
        }
      }
      toast.success("預設模板已強制覆蓋更新完成！", { id: toastId });
      fetchTemplates(); 
      fetchData(); 
    } catch (e) { toast.error("更新失敗", { id: toastId }); } finally { setLoading(false); }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (['staff', 'settings', 'templates', 'branches'].includes(activeTab) && currentUserRole !== 'admin') {
         throw new Error("權限不足：僅老闆可修改此設定");
      }

      if (activeTab === 'settings') {
         await setDoc(doc(db, 'settings', 'global_config'), { 
           validityDays: Number(formData.validityDays), 
           commissionLabels: formData.commissionLabels, 
           updatedAt: new Date().toISOString() 
         }, { merge: true });
         setGlobalLabels(formData.commissionLabels);
         toast.success("系統參數與自訂標籤更新成功！");
      } else {
        if (editingId) {
          await setDoc(doc(db, activeTab, editingId), { ...formData, updatedAt: new Date().toISOString() }, { merge: true });
          toast.success("更新成功！");
        } else {
          await addDoc(collection(db, activeTab), { ...formData, createdAt: new Date().toISOString() });
          toast.success("新增成功！");
        }
      }
      setFormData(initialForm); setEditingId(null); setIsCustomStaff(false); fetchData();
      if (activeTab === 'categories') fetchCategories();
      if (activeTab === 'templates') fetchTemplates();
      if (activeTab === 'branches') fetchBranches(); 
    } catch (error) { toast.error(error.message || "儲存失敗"); } finally { setLoading(false); }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setFormData({ ...initialForm, ...item, commissions: item.commissions || defaultCommissions, phoneNumber: item.phoneNumber || '+852' });
    
    if (item.name && !registeredStaff.includes(item.name) && activeTab === 'staff') {
      setIsCustomStaff(true);
    } else {
      setIsCustomStaff(false);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (['staff', 'settings', 'templates', 'branches'].includes(activeTab) && currentUserRole !== 'admin') return toast.error("權限不足：僅老闆可刪除此設定");
    if (!window.confirm("確定刪除？")) return;
    
    await deleteDoc(doc(db, activeTab, id)); 
    toast.success("已刪除"); 
    
    if (editingId === id) {
      setEditingId(null);
      setFormData(initialForm);
      setIsCustomStaff(false);
    }
    
    fetchData();
    if (activeTab === 'templates') fetchTemplates();
    if (activeTab === 'branches') fetchBranches();
  };

  const applyTemplate = (templateId) => {
    const selectedTemplate = templatesList.find(t => t.id === templateId);
    if (selectedTemplate) {
      setFormData({ ...formData, templateId: templateId, templateName: selectedTemplate.name, commissions: selectedTemplate.commissions });
      toast.success(`已載入【${selectedTemplate.name}】數值！請務必點擊下方「儲存」按鈕！`);
    } else { 
      setFormData({ ...formData, templateId: templateId, templateName: '' }); 
    }
  };

  const updateCommission = (code, field, value) => {
    setFormData({ ...formData, templateName: '', commissions: { ...formData.commissions, [code]: { ...formData.commissions[code], [field]: Number(value) } } });
  };

  // 🟢 控制群組收合/展開
  const toggleGroup = (groupName) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupName]: prev[groupName] === false ? true : false
    }));
  };

  const renderMatrixEditor = () => (
    <div className="col-span-2 pt-6 border-t border-gray-800">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-bold text-[#D4AF37]"><i className="fa-solid fa-calculator"></i> 拆帳矩陣參數設定</h3>
        <span className="text-[10px] text-gray-500 bg-white/5 px-3 py-1 rounded-full">公式：(實收總額 - 扣減成本) x 抽成比例</span>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {['W1', 'W2', 'W3', 'R1', 'R2', 'R3', 'P1', 'P2', 'P3', 'P4', 'P5', 'SCALP'].map(code => (
          <div key={code} className="bg-gray-900/50 p-4 rounded-2xl border border-gray-800 flex flex-col gap-2">
             <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex justify-between">
               <span>{globalLabels[code] ? `${code} - ${globalLabels[code]}` : code}</span>
             </div>
             <div className="flex items-center gap-2">
               <div className="flex-1 relative">
                 <span className="absolute left-3 top-2.5 text-gray-500 text-xs">扣 $</span>
                 <input type="number" inputMode="decimal" className="w-full bg-black border border-white/10 p-2.5 pl-10 rounded-lg text-white outline-none text-sm focus:border-red-500 transition-colors" value={formData.commissions?.[code]?.deduct || 0} onChange={e => updateCommission(code, 'deduct', e.target.value)} />
               </div>
               <span className="text-gray-600"><i className="fa-solid fa-xmark"></i></span>
               <div className="flex-1 relative">
                 <input type="number" inputMode="decimal" step="0.1" className="w-full bg-black border border-white/10 p-2.5 pr-8 rounded-lg text-white outline-none text-sm focus:border-green-500 transition-colors text-right font-bold" value={formData.commissions?.[code]?.percent || 0} onChange={e => updateCommission(code, 'percent', e.target.value)} />
                 <span className="absolute right-3 top-2.5 text-green-500 text-xs font-bold">%</span>
               </div>
             </div>
          </div>
        ))}
      </div>
    </div>
  );

  const visibleMenuGroups = menuGroups.map(group => {
    if (currentUserRole === 'manager') {
      return { ...group, items: group.items.filter(item => !['staff', 'settings', 'templates', 'branches'].includes(item.id)) };
    }
    return group;
  }).filter(group => group.items.length > 0);

  if (authLoading) return <div className="min-h-screen flex items-center justify-center text-[#D4AF37] bg-[#080808] font-bold tracking-widest text-xl">🔒 驗證安全權限中...</div>;
  if (!currentUserRole || ['member', 'reception', 'staff'].includes(currentUserRole)) return null;

  return (
    <div className="bg-[#121212] min-h-screen text-gray-100 p-6 md:p-10 font-sans pb-24">
      <Toaster position="top-right" />
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        <div className="lg:col-span-3 space-y-6">
          <h1 className="text-3xl font-black tracking-tighter flex flex-col gap-1 mb-8">
            <span className="bg-[#D4AF37] text-black px-3 py-1 rounded-lg w-fit text-sm tracking-widest flex items-center gap-2">
              TRUST OS <span className="bg-black/30 px-2 py-0.5 rounded text-[10px] uppercase text-white">{currentUserRole}</span>
            </span>
            CMS 管理中心
          </h1>

          {visibleMenuGroups.map((group, idx) => (
            <div key={idx} className="bg-gray-900/50 p-4 rounded-3xl border border-gray-800">
               <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3 ml-2">{group.title}</h3>
               <div className="space-y-1">
                 {group.items.map(tab => (
                   <button key={tab.id} onClick={() => { setActiveTab(tab.id); setEditingId(null); setFormData(initialForm); setIsCustomStaff(false); }} 
                     className={`w-full text-left px-4 py-3 rounded-2xl text-sm font-bold transition-all flex items-center gap-3 ${activeTab === tab.id ? 'bg-[#D4AF37] text-black shadow-lg' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                     <span className="text-lg w-6 text-center">{tab.icon}</span> {tab.label}
                   </button>
                 ))}
               </div>
            </div>
          ))}
        </div>

        <div className="lg:col-span-9">
          <div className={`bg-[#1a1a1a] p-8 rounded-[40px] border-2 ${editingId ? 'border-[#D4AF37]' : 'border-gray-800'} mb-12 shadow-2xl relative transition-all`}>
            <h2 className="text-xl font-bold mb-8 text-white flex items-center gap-2">
              {editingId ? '📝 修改項目' : activeTab === 'settings' ? '⚙️ 全局參數設定' : activeTab === 'templates' ? '💰 新增抽成模板' : activeTab === 'branches' ? '📍 新增門店' : '✨ 新增項目'}
            </h2>

            {['staff', 'settings', 'templates', 'branches'].includes(activeTab) && currentUserRole !== 'admin' ? (
               <div className="bg-red-500/10 border border-red-500/30 p-8 rounded-3xl text-center text-red-400 font-bold">
                 ⛔ 權限不足：僅系統管理員 (Admin) 可檢視與修改此機密設定。
               </div>
            ) : (
              <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-8">
                
                {activeTab === 'branches' && (
                  <>
                    <div className="space-y-2 col-span-2">
                      <label className="text-sm font-bold text-[#D4AF37] uppercase tracking-widest">門店名稱</label>
                      <input type="text" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required placeholder="如：大埔店、樂富店" />
                    </div>
                    <div className="col-span-2 bg-[#D4AF37]/10 border border-[#D4AF37]/30 p-4 rounded-2xl">
                      <p className="text-xs text-[#D4AF37]">💡 建立門店後，您可以在「髮型師名單」中將人員綁定至特定分店。未來的 POS 與報表系統將依此門店進行資料隔離。</p>
                    </div>
                  </>
                )}

                {activeTab === 'templates' && (
                  <>
                    <div className="col-span-2 bg-[#D4AF37]/10 border border-[#D4AF37]/30 p-6 rounded-2xl flex flex-col md:flex-row justify-between items-center gap-4 mb-4">
                      <div>
                        <h4 className="text-[#D4AF37] font-bold text-sm mb-1"><i className="fa-solid fa-wand-magic-sparkles"></i> 快速初始化模板庫</h4>
                        <p className="text-xs text-gray-400">點擊右側按鈕，系統將自動覆蓋更新預設拆帳公式。</p>
                      </div>
                      <button type="button" onClick={initDefaultTemplates} className="shrink-0 bg-[#D4AF37] text-black px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:scale-105 transition shadow-lg">
                        強制更新預設模板
                      </button>
                    </div>
                    <div className="space-y-2 col-span-2">
                      <label className="text-sm font-bold text-[#D4AF37] uppercase tracking-widest">自訂抽成模板名稱</label>
                      <input type="text" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required placeholder="如：A 級師傅、G 級大師、設計助理..." />
                    </div>
                    {renderMatrixEditor()}
                  </>
                )}

                {activeTab === 'settings' && (
                  <>
                    <div className="space-y-2 col-span-2 mb-4">
                      <label className="text-sm font-bold text-[#D4AF37] uppercase tracking-widest">T-Dollar 與 積分有效期限 (天數)</label>
                      <input type="number" inputMode="decimal" className="w-full bg-black border border-[#D4AF37]/50 p-4 rounded-xl text-white focus:border-[#D4AF37] outline-none text-xl font-black" value={formData.validityDays} onChange={e => setFormData({...formData, validityDays: e.target.value})} required />
                    </div>
                    
                    <div className="col-span-2 pt-6 border-t border-gray-800">
                      <h3 className="text-sm font-bold text-[#D4AF37] mb-2"><i className="fa-solid fa-tags"></i> 自訂系統拆帳標籤名稱 (可留空)</h3>
                      <p className="text-xs text-gray-400 mb-6">您可以自訂標籤的顯示名稱。若留空，系統將只顯示代碼 (例如 W1)。</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {['W1', 'W2', 'W3', 'R1', 'R2', 'R3', 'P1', 'P2', 'P3', 'P4', 'P5', 'SCALP'].map(code => (
                          <div key={code} className="space-y-1 bg-black p-3 rounded-xl border border-white/5">
                            <label className="text-[10px] font-bold text-gray-500 uppercase">{code} 標籤名稱</label>
                            <input 
                              type="text" 
                              className="w-full bg-transparent border-b border-white/10 p-1 text-white outline-none text-sm focus:border-[#D4AF37] transition-colors" 
                              value={formData.commissionLabels?.[code] !== undefined ? formData.commissionLabels[code] : (defaultLabels[code] || '')} 
                              onChange={e => setFormData({...formData, commissionLabels: {...formData.commissionLabels, [code]: e.target.value}})} 
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {activeTab === 'services' && (
                  <>
                    <div className="space-y-2"><label className="text-sm font-bold text-gray-400 uppercase tracking-widest">服務名稱</label><input type="text" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required /></div>
                    <div className="space-y-2"><label className="text-sm font-bold text-gray-400 uppercase tracking-widest">金額 (HKD)</label><input type="number" inputMode="decimal" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} required /></div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-blue-400 uppercase tracking-widest">所屬分店綁定</label>
                      <select className="w-full bg-black border border-blue-500/50 p-4 rounded-xl text-white outline-none font-bold focus:border-blue-400" value={formData.branch} onChange={e => setFormData({...formData, branch: e.target.value})} required>
                        <option value="">-- 請選擇門店 --</option><option value="ALL">🌐 全線通用 (所有門店)</option>{branchesList.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">選擇分類</label>
                      <select className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                        {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2 col-span-2">
                      <label className="text-sm font-bold text-purple-400 uppercase tracking-widest">綁定拆帳類別 (給系統結算用)</label>
                      <select className="w-full bg-black border border-purple-500/50 p-4 rounded-xl text-white outline-none focus:border-purple-400" value={formData.commissionCode} onChange={e => setFormData({...formData, commissionCode: e.target.value})}>
                        {['W1', 'W2', 'W3', 'R1', 'R2', 'R3'].map(c => <option key={c} value={c}>{globalLabels[c] ? `${c} - ${globalLabels[c]}` : c}</option>)}
                      </select>
                    </div>
                  </>
                )}

                {activeTab === 'packages' && (
                  <>
                    <div className="space-y-2 col-span-2"><label className="text-sm font-bold text-[#D4AF37] uppercase tracking-widest">套票/次數券名稱</label><input type="text" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required placeholder="如：VIP Scalp 3000 (買30送3)" /></div>
                    <div className="space-y-2"><label className="text-sm font-bold text-gray-400 uppercase tracking-widest">套票總售價 (HKD)</label><input type="number" inputMode="decimal" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} required placeholder="免費贈送用請填 0" /></div>
                    <div className="space-y-2"><label className="text-sm font-bold text-gray-400 uppercase tracking-widest">內含總格數 (次數)</label><input type="number" inputMode="decimal" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]" value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} required placeholder="如：33" /></div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-blue-400 uppercase tracking-widest">所屬分店綁定</label>
                      <select className="w-full bg-black border border-blue-500/50 p-4 rounded-xl text-white outline-none font-bold focus:border-blue-400" value={formData.branch} onChange={e => setFormData({...formData, branch: e.target.value})} required>
                        <option value="">-- 請選擇門店 --</option><option value="ALL">🌐 全線通用 (所有門店)</option>{branchesList.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                      </select>
                    </div>
                    {/* 🟢 套票補上分類選擇 */}
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">選擇分類</label>
                      <select className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                        <option value="">-- 選擇分類 (選填) --</option>
                        {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2 col-span-2">
                      <label className="text-sm font-bold text-purple-400 uppercase tracking-widest">綁定拆帳類別</label>
                      <select className="w-full bg-black border border-purple-500/50 p-4 rounded-xl text-white outline-none focus:border-purple-400" value={formData.commissionCode} onChange={e => setFormData({...formData, commissionCode: e.target.value})}>
                        {['SCALP', 'P1', 'P2', 'P3', 'P4', 'P5'].map(c => <option key={c} value={c}>{globalLabels[c] ? `${c} - ${globalLabels[c]}` : c}</option>)}
                      </select>
                    </div>
                  </>
                )}

                {activeTab === 'staff' && (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-[#D4AF37] uppercase tracking-widest">髮型師姓名</label>
                      {!isCustomStaff ? (
                        <select className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]" value={registeredStaff.includes(formData.name) ? formData.name : (formData.name ? 'CUSTOM' : '')} onChange={e => { if (e.target.value === 'CUSTOM') { setIsCustomStaff(true); setFormData({...formData, name: ''}); } else { setFormData({...formData, name: e.target.value}); } }} required>
                          <option value="">-- 請選擇已註冊員工 --</option>{registeredStaff.map(name => <option key={name} value={name}>{name}</option>)}<option value="CUSTOM">➕ 手動輸入 (無帳號的自由業)</option>
                        </select>
                      ) : (
                        <div className="flex gap-2">
                          <input type="text" className="flex-1 bg-gray-900 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required placeholder="輸入自訂姓名..." />
                          <button type="button" onClick={() => { setIsCustomStaff(false); setFormData({...formData, name: ''}); }} className="px-6 bg-gray-800 text-gray-400 rounded-xl hover:text-white hover:bg-gray-700 transition-colors font-bold text-sm">返回選單</button>
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">聯絡電話 (Phone)</label>
                      <input type="tel" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]" value={formData.phoneNumber} onChange={e => setFormData({...formData, phoneNumber: e.target.value})} required placeholder="如: +85298765432" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-blue-400 uppercase tracking-widest">所屬分店綁定</label>
                      <select className="w-full bg-black border border-blue-500/50 p-4 rounded-xl text-white outline-none font-bold focus:border-blue-400" value={formData.branch} onChange={e => setFormData({...formData, branch: e.target.value})} required>
                        <option value="">-- 請選擇門店 --</option><option value="ALL">🌐 全線通用 (跨店支援)</option>{branchesList.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2 col-span-2">
                      <label className="text-sm font-bold text-purple-400 uppercase tracking-widest">📥 載入預設抽成模板 (載入後可微調)</label>
                      <select className="w-full bg-black border border-purple-500/50 p-4 rounded-xl text-white outline-none font-bold focus:border-purple-400" value={formData.templateId} onChange={e => applyTemplate(e.target.value)}>
                        <option value="">-- 保持原數值或自訂比例 --</option>{templatesList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      {formData.templateName && <p className="text-xs text-green-400 mt-2 bg-green-500/10 p-2 rounded-lg border border-green-500/20">✅ <strong>目前已載入：{formData.templateName} 數值</strong> <br/>(確認無誤後，請務必點擊最下方「儲存」按鈕！)</p>}
                    </div>
                    {renderMatrixEditor()}
                  </>
                )}

                {activeTab === 'categories' && (<div className="space-y-2 col-span-2"><label className="text-sm font-bold text-gray-400 uppercase tracking-widest">新分類名稱</label><input type="text" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required /></div>)}
                {activeTab === 'promos' && (
                  <><div className="space-y-2 col-span-2"><label className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-2 block">優惠標題</label><div className="flex flex-wrap gap-2 mb-3 bg-black/40 p-3 rounded-xl border border-gray-800"><span className="text-xs text-gray-500 w-full mb-1">快速插入 Emoji:</span>{promoEmojiList.map(e => (<button key={e} type="button" onClick={() => addPromoEmoji(e)} className="text-2xl hover:scale-125 transition active:scale-90">{e}</button>))}</div><input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} required /></div><div className="space-y-2 col-span-2 md:col-span-1"><label className="text-sm font-bold text-gray-400 uppercase tracking-widest">有效日期至</label><input type="date" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.expiry} onChange={e => setFormData({...formData, expiry: e.target.value})} required /></div><div className="space-y-2 col-span-2"><label className="text-sm font-bold text-gray-400 uppercase tracking-widest">詳細內容</label><textarea className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white h-32 focus:border-[#D4AF37] outline-none" value={formData.content} onChange={e => setFormData({...formData, content: e.target.value})} required /></div></>
                )}
                {activeTab === 'rewards' && (
                  <><div className="space-y-2"><label className="text-sm font-bold text-gray-400 uppercase tracking-widest">禮品名稱</label><input type="text" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required /></div><div className="space-y-2"><label className="text-sm font-bold text-gray-400 uppercase tracking-widest">所需積分 (Points)</label><input type="number" inputMode="decimal" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]" value={formData.points} onChange={e => setFormData({...formData, points: e.target.value})} required /></div><div className="space-y-2"><label className="text-sm font-bold text-gray-400 uppercase tracking-widest block mb-1">圖標 (Emoji)</label><div className="flex flex-wrap gap-2 mb-3 bg-black/40 p-3 rounded-xl border border-gray-800">{salonEmojiList.map(e => <button key={e} type="button" onClick={() => setFormData({...formData, icon: e})} className="text-2xl hover:scale-125 transition active:scale-90">{e}</button>)}</div><input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.icon} onChange={e => setFormData({...formData, icon: e.target.value})} required /></div><div className="space-y-2"><label className="text-sm font-bold text-gray-400 uppercase tracking-widest block mb-1">標籤 (Tag - 選填)</label><input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.tag} onChange={e => setFormData({...formData, tag: e.target.value})} /></div></>
                )}

                {activeTab === 'tiers' && (
                  <>
                    <div className="space-y-2 col-span-2"><label className="text-sm font-bold text-[#D4AF37] uppercase tracking-widest">等級名稱</label><input type="text" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required /></div>
                    <div className="space-y-2"><label className="text-sm font-bold text-gray-400 uppercase tracking-widest">累積充值門檻 (HKD)</label><input type="number" inputMode="decimal" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]" value={formData.threshold} onChange={e => setFormData({...formData, threshold: e.target.value})} required /></div>
                    <div className="space-y-2"><label className="text-sm font-bold text-gray-400 uppercase tracking-widest">全單折扣 (例: 0.8 = 8折)</label><input type="number" inputMode="decimal" step="0.01" max="1" min="0" className="w-full bg-gray-900 p-4 rounded-xl text-white outline-none focus:border-[#D4AF37]" value={formData.discount} onChange={e => setFormData({...formData, discount: e.target.value})} required /></div>
                    <div className="space-y-2 pt-4 border-t border-gray-800 col-span-2"><p className="text-xs font-bold text-purple-400"><i className="fa-solid fa-gift"></i> 達成此門檻的「升級自動派發獎勵」</p></div>
                    <div className="space-y-2"><label className="text-sm font-bold text-gray-400 uppercase tracking-widest">1. 額外贈送積分</label><input type="number" inputMode="decimal" className="w-full bg-black border border-purple-500/30 p-4 rounded-xl text-white focus:border-purple-400 outline-none" value={formData.upgradeBonus} onChange={e => setFormData({...formData, upgradeBonus: e.target.value})} placeholder="如不贈送請填 0" /></div>
                    <div className="space-y-2"><label className="text-sm font-bold text-gray-400 uppercase tracking-widest">2. 自動派發套票/實體券</label><select className="w-full bg-black border border-purple-500/30 p-4 rounded-xl text-white focus:border-purple-400 outline-none" value={formData.giftPackageName} onChange={e => setFormData({...formData, giftPackageName: e.target.value})}><option value="">無贈送套票</option>{packagesList.map(p => <option key={p.id} value={p.name}>{p.name} (含 {p.quantity} 格)</option>)}</select></div>
                    <div className="space-y-2 col-span-2 text-[10px] text-gray-500 bg-black/50 p-4 rounded-xl border border-gray-800 mt-2">
                       <p>💡 <strong>說明：</strong> 當客人充值並首次跨越此門檻時，系統將自動派發設定的「積分」與「套票」至客人的帳戶中作為里程碑獎勵。</p>
                    </div>
                  </>
                )}

                <div className="flex gap-4 col-span-2 mt-4">
                  <button type="submit" className="flex-1 bg-white text-black font-black py-4 rounded-2xl hover:bg-[#D4AF37] transition-all shadow-xl active:scale-95 tracking-widest">
                    {activeTab === 'settings' ? '💾 儲存全局設定' : editingId ? '💾 儲存修改內容' : '➕ 確認新增資料'}
                  </button>
                  {editingId && (
                    <button type="button" onClick={() => {setEditingId(null); setFormData(initialForm); setIsCustomStaff(false);}} className="px-8 bg-gray-800 text-white font-bold rounded-2xl tracking-widest">取消</button>
                  )}
                </div>
              </form>
            )}
          </div>

          {/* 🟢 列表區：手風琴層級式分組渲染 */}
          {activeTab !== 'settings' && (!['staff', 'templates', 'branches'].includes(activeTab) || currentUserRole === 'admin') && (
            <div className="space-y-4">
              <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest px-2 mb-4">現有紀錄資料表</h3>
              
              {(() => {
                if (list.length === 0 && !loading) {
                  return <div className="text-center py-20 text-gray-600 font-bold border border-dashed border-gray-800 rounded-3xl">此分類目前沒有資料</div>;
                }

                // 🟢 將 List 進行維度分組
                const groupedList = list.reduce((acc, item) => {
                  let key = '全部項目';
                  if (['services', 'packages'].includes(activeTab)) key = item.category || '未分類 (Uncategorized)';
                  else if (activeTab === 'staff') key = item.branch === 'ALL' ? '🌐 全線通用 (跨店)' : (item.branch || '未綁定門店');
                  else if (activeTab === 'templates') key = '抽成模板列表';
                  else if (activeTab === 'branches') key = '門店列表';
                  else if (activeTab === 'tiers') key = '會員等級列表';
                  else key = '項目列表';

                  if (!acc[key]) acc[key] = [];
                  acc[key].push(item);
                  return acc;
                }, {});

                return Object.entries(groupedList).map(([groupName, items]) => (
                  <div key={groupName} className="mb-6">
                    {groupName !== '項目列表' && groupName !== '全部項目' && (
                      <div 
                        onClick={() => toggleGroup(groupName)}
                        className="flex justify-between items-center bg-[#1a1a1a] p-4 rounded-2xl cursor-pointer border border-gray-800 hover:border-[#D4AF37]/50 transition-colors mb-3 group"
                      >
                        <h4 className="font-bold text-white flex items-center gap-2">
                          <i className="fa-solid fa-folder-open text-[#D4AF37]"></i> {groupName}
                          <span className="text-[10px] bg-white/10 text-gray-400 px-2 py-0.5 rounded-full">{items.length} 項</span>
                        </h4>
                        <i className={`fa-solid fa-chevron-${expandedGroups[groupName] === true ? 'up' : 'down'} text-gray-500 group-hover:text-[#D4AF37] transition-colors`}></i>
                      </div>
                    )}
                    
                    {/* 🟢 修改：預設為隱藏，只有點擊展開時才顯示 (=== true) */}
                    {expandedGroups[groupName] === true && (
                      <div className={`space-y-3 ${groupName !== '項目列表' && groupName !== '全部項目' ? 'pl-2 md:pl-6 border-l-2 border-gray-800 ml-2' : ''}`}>
                        {items.map(item => (
                          <div key={item.id} className="bg-gray-900/60 p-5 rounded-2xl border border-gray-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition hover:bg-gray-900">
                            <div className="flex items-center gap-4 w-full md:w-auto">
                              <div className="w-10 h-10 rounded-xl bg-[#D4AF37]/10 flex items-center justify-center text-xl shrink-0">
                                  {activeTab === 'packages' ? '🎫' : activeTab === 'services' ? '💆' : activeTab === 'staff' ? '✂️' : activeTab === 'templates' ? '💰' : activeTab === 'branches' ? '📍' : activeTab === 'categories' ? '🏷️' : activeTab === 'promos' ? '📢' : activeTab === 'tiers' ? '👑' : (item.icon || '🎁')}
                              </div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-lg text-white">{item.name || item.title}</span>
                                  {['services', 'packages'].includes(activeTab) && item.commissionCode && (
                                    <span className="text-[9px] bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded border border-purple-500/30 font-bold uppercase tracking-tighter">
                                      {item.commissionCode} 類
                                    </span>
                                  )}
                                  {activeTab === 'staff' && (
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-tighter ${item.templateName || item.templateId ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
                                      {item.templateName ? `📄 ${item.templateName}` : item.templateId ? '📄 已套用模板' : '⚙️ 自訂比例'}
                                    </span>
                                  )}
                                  {['staff', 'services', 'packages'].includes(activeTab) && item.branch && (
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-tighter ${item.branch === 'ALL' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
                                      {item.branch === 'ALL' ? '🌐 跨店通用' : `📍 ${item.branch}`}
                                    </span>
                                  )}
                                  {activeTab === 'staff' && item.phoneNumber && (
                                    <span className="text-[9px] bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded border border-gray-700 font-mono tracking-widest">
                                      📞 {item.phoneNumber}
                                    </span>
                                  )}
                                </div>
                                
                                <div className="flex flex-wrap gap-3 mt-1.5 text-xs items-center">
                                  {activeTab === 'packages' && <><span className="text-gray-400 font-mono font-bold">${item.price}</span><span className="text-[#D4AF37] font-bold bg-[#D4AF37]/10 px-1.5 py-0.5 rounded border border-[#D4AF37]/30">內含 {item.quantity} 格</span></>}
                                  {activeTab === 'services' && <span className="text-gray-400 font-mono font-bold">${item.price}</span>}
                                  {activeTab === 'branches' && <span className="text-gray-500 italic">連鎖門店資料</span>}
                                  {activeTab === 'templates' && <span className="text-gray-500 italic">包含 W1-W3, R1-R3, P1-P5, SCALP 公式</span>}
                                  {activeTab === 'tiers' && (
                                    <>
                                      <span className="text-[#D4AF37] font-mono font-bold">門檻: ${item.threshold}</span>
                                      <span className="text-green-400 font-bold">折扣: {Number(item.discount) * 10} 折</span>
                                      {item.upgradeBonus > 0 && <span className="text-purple-400 font-bold bg-purple-500/20 px-1.5 py-0.5 rounded border border-purple-500/30">🎁 送 {item.upgradeBonus} 分</span>}
                                      {item.giftPackageName && <span className="text-pink-400 font-bold bg-pink-500/20 px-1.5 py-0.5 rounded border border-pink-500/30">🎫 送套票: {item.giftPackageName}</span>}
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 w-full md:w-auto mt-2 md:mt-0">
                              <button onClick={() => startEdit(item)} className="flex-1 md:flex-none px-4 py-2 bg-blue-900/30 text-blue-400 border border-blue-800/50 rounded-lg hover:bg-blue-600 hover:text-white transition text-xs font-bold">修改</button>
                              <button onClick={() => handleDelete(item.id)} className="flex-1 md:flex-none px-4 py-2 bg-red-900/30 text-red-400 border border-red-800/50 rounded-lg hover:bg-red-600 hover:text-white transition text-xs font-bold">刪除</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ));
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
