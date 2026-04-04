"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, updateDoc, setDoc } from 'firebase/firestore'; // 🟢 補上 setDoc
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Toaster, toast } from 'react-hot-toast';

export default function AdminManagePage() {
  const [activeTab, setActiveTab] = useState('services'); 
  const [list, setList] = useState([]);
  const [categories, setCategories] = useState([]); 
  const [packagesList, setPackagesList] = useState([]); // 🟢 供會員等級綁定贈品用
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const router = useRouter();

  // 🟢 擴充表單：完美整合 套票 (quantity) / 升級里程碑獎勵 (upgradeBonus) / 贈送套票 (giftPackageName) / 全局設定 (validityDays)
  const initialForm = { 
    name: '', price: '', category: '', title: '', content: '', 
    expiry: '', points: '', icon: '', tag: '', threshold: '', discount: '', 
    quantity: '', upgradeBonus: '', giftPackageName: '', validityDays: 365
  };
  const [formData, setFormData] = useState(initialForm);

  const promoEmojiList = ['🎁', '🔥', '✨', '📢', '📅', '🎉', '⚡', '🏆'];
  const salonEmojiList = ['🧴', '💆‍♀️', '💆‍♂️', '✂️', '✨', '💧', '🌿', '👑', '🎀', '💅', '🛍️', '🎁'];

  // 🟢 重新整理的 CMS 導覽列分類 (三大區塊)
  const menuGroups = [
    {
      title: "🛍️ 營運與商品定價",
      items: [
        { id: 'services', label: '服務定價', icon: '💇‍♂️' },
        { id: 'categories', label: '分類設定', icon: '🏷️' },
        { id: 'packages', label: '套票與次數券', icon: '🎫' },
      ]
    },
    {
      title: "👑 會員與行銷模組",
      items: [
        { id: 'tiers', label: '會員等級與升級', icon: '👑' },
        { id: 'rewards', label: '積分換領商城', icon: '🎁' },
        { id: 'promos', label: '前台網頁公告', icon: '📢' },
      ]
    },
    {
      title: "⚙️ 系統與全局設定",
      items: [
        { id: 'staff', label: '髮型師名單', icon: '✂️' },
        { id: 'settings', label: '系統全局參數', icon: '⚙️' },
      ]
    }
  ];

  useEffect(() => {
    onAuthStateChanged(auth, (user) => {
      if (!user) return router.push('/login');
    });
    fetchData();
    fetchCategories(); 
    fetchPackages(); // 🟢 載入套票供下拉選單使用
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    const querySnapshot = await getDocs(collection(db, activeTab));
    const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (activeTab === 'tiers') data.sort((a, b) => Number(b.threshold) - Number(a.threshold));
    
    // 🟢 全局設定通常只有一筆紀錄
    if (activeTab === 'settings' && data.length === 0) {
       setFormData({...initialForm, validityDays: 365, name: '全局系統參數'});
    }
    
    setList(data);
    setLoading(false);
  };

  const fetchCategories = async () => {
    const querySnapshot = await getDocs(collection(db, 'categories'));
    const cats = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    setCategories(cats);
    if (cats.length > 0 && !formData.category) setFormData(prev => ({ ...prev, category: cats[0].name }));
  };

  const fetchPackages = async () => {
    const snap = await getDocs(collection(db, 'packages'));
    setPackagesList(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (activeTab === 'settings') {
         // 🟢 Settings 採用覆蓋單一文件模式
         await setDoc(doc(db, 'settings', 'global_config'), { validityDays: Number(formData.validityDays), updatedAt: new Date().toISOString() });
         toast.success("系統參數更新成功！");
      } else {
        if (editingId) {
          await updateDoc(doc(db, activeTab, editingId), { ...formData, updatedAt: new Date().toISOString() });
          toast.success("更新成功！");
        } else {
          await addDoc(collection(db, activeTab), { ...formData, createdAt: new Date().toISOString() });
          toast.success("新增成功！");
        }
      }
      setFormData(initialForm);
      setEditingId(null);
      fetchData();
      if (activeTab === 'categories') fetchCategories();
    } catch (error) {
      toast.error("儲存失敗");
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setFormData({ ...initialForm, ...item });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (!window.confirm("確定刪除？")) return;
    await deleteDoc(doc(db, activeTab, id));
    toast.success("已刪除");
    fetchData();
    if (activeTab === 'categories') fetchCategories();
  };

  const addPromoEmoji = (emoji) => setFormData({ ...formData, title: formData.title + emoji });

  return (
    <div className="bg-[#121212] min-h-screen text-gray-100 p-6 md:p-10 font-sans pb-24">
      <Toaster position="top-right" />
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* 🟢 重新分類的左側導覽列 */}
        <div className="lg:col-span-3 space-y-6">
          <h1 className="text-3xl font-black tracking-tighter flex flex-col gap-1 mb-8">
            <span className="bg-[#D4AF37] text-black px-3 py-1 rounded-lg w-fit text-sm tracking-widest">TRUST OS</span>
            CMS 管理中心
          </h1>

          {menuGroups.map((group, idx) => (
            <div key={idx} className="bg-gray-900/50 p-4 rounded-3xl border border-gray-800">
               <h3 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3 ml-2">{group.title}</h3>
               <div className="space-y-1">
                 {group.items.map(tab => (
                   <button key={tab.id} onClick={() => { setActiveTab(tab.id); setEditingId(null); setFormData(initialForm); }} 
                     className={`w-full text-left px-4 py-3 rounded-2xl text-sm font-bold transition-all flex items-center gap-3 ${activeTab === tab.id ? 'bg-[#D4AF37] text-black shadow-lg' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                     <span className="text-lg w-6 text-center">{tab.icon}</span> {tab.label}
                   </button>
                 ))}
               </div>
            </div>
          ))}
        </div>

        {/* 右側主畫面 */}
        <div className="lg:col-span-9">
          <div className={`bg-[#1a1a1a] p-8 rounded-[40px] border-2 ${editingId ? 'border-[#D4AF37]' : 'border-gray-800'} mb-12 shadow-2xl relative transition-all`}>
            <h2 className="text-xl font-bold mb-8 text-white flex items-center gap-2">
              {editingId ? '📝 修改項目' : activeTab === 'settings' ? '⚙️ 全局參數設定' : '✨ 新增項目'}
            </h2>

            <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-8">
              
              {/* 🟢 系統全局設定 */}
              {activeTab === 'settings' && (
                <>
                  <div className="space-y-2 col-span-2">
                    <label className="text-sm font-bold text-[#D4AF37] uppercase tracking-widest">T-Dollar 與 積分有效期限 (天數)</label>
                    <input type="number" className="w-full bg-black border border-[#D4AF37]/50 p-4 rounded-xl text-white focus:border-[#D4AF37] outline-none text-xl font-black" value={formData.validityDays} onChange={e => setFormData({...formData, validityDays: e.target.value})} required />
                    <p className="text-[10px] text-gray-500 mt-2">💡 系統預設為 365 天 (一年)。當客人註冊或於門市儲值時，系統會自動將客人的餘額效期延長至「當下日期 + 此天數」。</p>
                  </div>
                </>
              )}

              {activeTab === 'services' && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">項目名稱</label>
                    <input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">金額 (HKD)</label>
                    <input type="number" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} required />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">選擇分類</label>
                    <select className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                      {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      {categories.length === 0 && <option>請先去分類設定新增類別</option>}
                    </select>
                  </div>
                </>
              )}

              {activeTab === 'categories' && (
                <div className="space-y-2 col-span-2">
                  <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">新分類名稱</label>
                  <input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                </div>
              )}

              {activeTab === 'packages' && (
                <>
                  <div className="space-y-2 col-span-2">
                    <label className="text-sm font-bold text-[#D4AF37] uppercase tracking-widest">套票/次數券名稱</label>
                    <input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required placeholder="如：VIP Scalp 3000 (買30送3)" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">套票總售價 (HKD)</label>
                    <input type="number" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} required placeholder="免費贈送用請填 0" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">內含總格數 (次數)</label>
                    <input type="number" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.quantity} onChange={e => setFormData({...formData, quantity: e.target.value})} required placeholder="如：33" />
                  </div>
                  <div className="space-y-2 col-span-2 text-[10px] text-gray-500 bg-black/50 p-4 rounded-xl border border-gray-800">
                     <p>💡 <strong>說明：</strong> 客人購買此套票後，手機端將自動增加對應的「格數」。後續結帳時，店員可選擇直接「扣除格數」來完成服務結帳。</p>
                  </div>
                </>
              )}

              {activeTab === 'staff' && (
                <div className="space-y-2 col-span-2">
                  <label className="text-sm font-bold text-[#D4AF37] uppercase tracking-widest">髮型師姓名</label>
                  <input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required placeholder="如：Ivan" />
                  <p className="text-[10px] text-gray-500 mt-2">💡 欲設定髮型師的抽成與薪資參數，請至「財務報表」模組中設定。</p>
                </div>
              )}

              {activeTab === 'promos' && (
                <>
                  <div className="space-y-2 col-span-2">
                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-2 block">優惠標題</label>
                    <div className="flex flex-wrap gap-2 mb-3 bg-black/40 p-3 rounded-xl border border-gray-800">
                      <span className="text-xs text-gray-500 w-full mb-1">快速插入 Emoji:</span>
                      {promoEmojiList.map(e => (
                        <button key={e} type="button" onClick={() => addPromoEmoji(e)} className="text-2xl hover:scale-125 transition active:scale-90">{e}</button>
                      ))}
                    </div>
                    <input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} required />
                  </div>
                  <div className="space-y-2 col-span-2 md:col-span-1">
                      <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">有效日期至</label>
                      <input type="date" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.expiry} onChange={e => setFormData({...formData, expiry: e.target.value})} required />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">詳細內容</label>
                    <textarea className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white h-32 focus:border-[#D4AF37] outline-none" value={formData.content} onChange={e => setFormData({...formData, content: e.target.value})} required />
                  </div>
                </>
              )}

              {activeTab === 'rewards' && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">禮品名稱</label>
                    <input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">所需積分 (Points)</label>
                    <input type="number" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.points} onChange={e => setFormData({...formData, points: e.target.value})} required />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest block mb-1">圖標 (Emoji)</label>
                    <div className="flex flex-wrap gap-2 mb-3 bg-black/40 p-3 rounded-xl border border-gray-800">
                      {salonEmojiList.map(e => <button key={e} type="button" onClick={() => setFormData({...formData, icon: e})} className="text-2xl hover:scale-125 transition active:scale-90">{e}</button>)}
                    </div>
                    <input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.icon} onChange={e => setFormData({...formData, icon: e.target.value})} required />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest block mb-1">標籤 (Tag - 選填)</label>
                    <input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.tag} onChange={e => setFormData({...formData, tag: e.target.value})} />
                  </div>
                </>
              )}

              {/* 🟢 Tiers 加入里程碑獎勵與贈送套票 */}
              {activeTab === 'tiers' && (
                <>
                  <div className="space-y-2 col-span-2">
                    <label className="text-sm font-bold text-[#D4AF37] uppercase tracking-widest">等級名稱</label>
                    <input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">累積充值門檻 (HKD)</label>
                    <input type="number" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.threshold} onChange={e => setFormData({...formData, threshold: e.target.value})} required />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">全單折扣 (例: 0.8 = 8折)</label>
                    <input type="number" step="0.01" max="1" min="0" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.discount} onChange={e => setFormData({...formData, discount: e.target.value})} required />
                  </div>
                  
                  <div className="space-y-2 pt-4 border-t border-gray-800 col-span-2"><p className="text-xs font-bold text-purple-400"><i className="fa-solid fa-gift"></i> 達成此門檻的「升級自動派發獎勵」</p></div>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">1. 額外贈送積分</label>
                    <input type="number" className="w-full bg-black border border-purple-500/30 p-4 rounded-xl text-white focus:border-purple-400 outline-none" value={formData.upgradeBonus} onChange={e => setFormData({...formData, upgradeBonus: e.target.value})} placeholder="如不贈送請填 0" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">2. 自動派發套票/實體券</label>
                    <select className="w-full bg-black border border-purple-500/30 p-4 rounded-xl text-white focus:border-purple-400 outline-none" value={formData.giftPackageName} onChange={e => setFormData({...formData, giftPackageName: e.target.value})}>
                      <option value="">無贈送套票</option>
                      {packagesList.map(p => <option key={p.id} value={p.name}>{p.name} (含 {p.quantity} 格)</option>)}
                    </select>
                  </div>
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
                  <button type="button" onClick={() => {setEditingId(null); setFormData(initialForm);}} className="px-8 bg-gray-800 text-white font-bold rounded-2xl tracking-widest">取消</button>
                )}
              </div>
            </form>
          </div>

          {/* 列表區 (不顯示 Settings，因為它只有一筆) */}
          {activeTab !== 'settings' && (
            <div className="space-y-4">
              <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest px-2 mb-4">現有紀錄資料表</h3>
              {list.map((item) => (
                <div key={item.id} className="bg-gray-900/60 p-6 rounded-3xl border border-gray-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition hover:bg-gray-900">
                  <div className="flex items-center gap-5">
                    <div className="w-12 h-12 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center text-2xl shrink-0">
                        {activeTab === 'packages' ? '🎫' : activeTab === 'services' ? '💆' : activeTab === 'staff' ? '✂️' : activeTab === 'categories' ? '🏷️' : activeTab === 'promos' ? '📢' : activeTab === 'tiers' ? '👑' : (item.icon || '🎁')}
                    </div>
                    <div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-xl text-white">{item.name || item.title}</span>
                        {item.category && activeTab === 'services' && <span className="text-[10px] bg-white/10 text-[#D4AF37] px-2 py-0.5 rounded-md font-bold uppercase tracking-tighter">{item.category}</span>}
                      </div>
                      <div className="flex flex-wrap gap-4 mt-1 text-sm items-center">
                        {/* 🟢 套票專屬顯示邏輯 */}
                        {activeTab === 'packages' && (
                          <>
                            <span className="text-gray-400 font-mono font-bold text-base">${item.price}</span>
                            <span className="text-[#D4AF37] font-bold text-base bg-[#D4AF37]/10 px-2 py-0.5 rounded-md border border-[#D4AF37]/30">內含 {item.quantity} 格</span>
                          </>
                        )}
                        
                        {activeTab === 'services' && <span className="text-gray-400 font-mono font-bold text-base">${item.price}</span>}
                        
                        {/* 🟢 等級專屬顯示 (含升級雙重獎勵) */}
                        {activeTab === 'tiers' && (
                          <>
                            <span className="text-[#D4AF37] font-mono font-bold text-base">門檻: ${item.threshold}</span>
                            <span className="text-green-400 font-bold text-base">折扣: {Number(item.discount) * 10} 折</span>
                            {item.upgradeBonus && Number(item.upgradeBonus) > 0 && <span className="text-purple-400 font-bold text-sm bg-purple-500/20 px-2 py-0.5 rounded border border-purple-500/30">🎁 送 {item.upgradeBonus} 分</span>}
                            {item.giftPackageName && <span className="text-pink-400 font-bold text-sm bg-pink-500/20 px-2 py-0.5 rounded border border-pink-500/30">🎫 送套票: {item.giftPackageName}</span>}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 w-full md:w-auto mt-2 md:mt-0">
                    <button onClick={() => startEdit(item)} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-900/30 text-blue-400 border border-blue-800/50 rounded-xl hover:bg-blue-600 hover:text-white transition">
                      <i className="fa-solid fa-pen-to-square"></i> <span>修改</span>
                    </button>
                    <button onClick={() => handleDelete(item.id)} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-red-900/30 text-red-400 border border-red-800/50 rounded-xl hover:bg-red-600 hover:text-white transition">
                      <i className="fa-solid fa-trash-can"></i> <span>刪除</span>
                    </button>
                  </div>
                </div>
              ))}
              {list.length === 0 && !loading && (
                 <div className="text-center py-20 text-gray-600 font-bold border border-dashed border-gray-800 rounded-3xl">此分類目前沒有資料</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
