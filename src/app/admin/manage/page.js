"use client";

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { Toaster, toast } from 'react-hot-toast';

export default function AdminManagePage() {
  const [activeTab, setActiveTab] = useState('services'); // services, staff, promos, categories, rewards, packages
  const [list, setList] = useState([]);
  const [categories, setCategories] = useState([]); 
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const router = useRouter();

  // 🟢 表單擴充：加入 tDollar (增值實得金額)
  const initialForm = { name: '', price: '', category: '', title: '', content: '', expiry: '', points: '', icon: '', tag: '', tDollar: '' };
  const [formData, setFormData] = useState(initialForm);

  const promoEmojiList = ['🎁', '🔥', '✨', '📢', '📅', '🎉', '⚡', '🏆'];
  const salonEmojiList = ['🧴', '💆‍♀️', '💆‍♂️', '✂️', '✨', '💧', '🌿', '👑', '🎀', '💅', '🛍️', '🎁'];

  useEffect(() => {
    onAuthStateChanged(auth, (user) => {
      if (!user) return router.push('/login');
    });
    fetchData();
    fetchCategories(); 
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    const querySnapshot = await getDocs(collection(db, activeTab));
    const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    setList(data);
    setLoading(false);
  };

  const fetchCategories = async () => {
    const querySnapshot = await getDocs(collection(db, 'categories'));
    const cats = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    setCategories(cats);
    if (cats.length > 0 && !formData.category) {
        setFormData(prev => ({ ...prev, category: cats[0].name }));
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (editingId) {
        await updateDoc(doc(db, activeTab, editingId), { ...formData, updatedAt: new Date().toISOString() });
        toast.success("更新成功！");
      } else {
        await addDoc(collection(db, activeTab), { ...formData, createdAt: new Date().toISOString() });
        toast.success("新增成功！");
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

  const addPromoEmoji = (emoji) => {
    setFormData({ ...formData, title: formData.title + emoji });
  };

  const existingTags = ['rewards', 'packages'].includes(activeTab)
    ? [...new Set(list.filter(item => item.tag).map(item => item.tag))] 
    : [];

  return (
    <div className="bg-[#121212] min-h-screen text-gray-100 p-6 md:p-10 font-sans pb-24">
      <Toaster position="top-right" />
      <div className="max-w-5xl mx-auto">
        
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
          <h1 className="text-3xl font-black tracking-tighter flex items-center gap-3">
            <span className="bg-[#D4AF37] text-black px-3 py-1 rounded-lg">TRUST</span>
            資料管理 CMS
          </h1>
        </header>

        {/* 六大分頁 */}
        <div className="flex flex-wrap gap-2 mb-8 bg-gray-900/80 p-1.5 rounded-2xl border border-gray-800">
          {[
            { id: 'services', label: '服務定價', icon: '💇‍♂️' },
            { id: 'categories', label: '分類設定', icon: '🏷️' },
            { id: 'staff', label: '髮型師', icon: '✂️' },
            { id: 'promos', label: '首頁公告', icon: '📢' },
            { id: 'rewards', label: '積分商城', icon: '🎁' },
            { id: 'packages', label: '增值方案', icon: '💳' } // 🟢 新增的增值方案
          ].map(tab => (
            <button key={tab.id} onClick={() => { setActiveTab(tab.id); setEditingId(null); setFormData(initialForm); }} 
              className={`flex-1 min-w-[90px] py-3 rounded-xl text-xs md:text-sm font-bold transition-all flex items-center justify-center gap-2 ${activeTab === tab.id ? 'bg-[#D4AF37] text-black shadow-xl scale-105' : 'text-gray-400 hover:bg-gray-800'}`}>
              <span>{tab.icon}</span> {tab.label}
            </button>
          ))}
        </div>

        <div className={`bg-[#1a1a1a] p-8 rounded-3xl border-2 ${editingId ? 'border-[#D4AF37]' : 'border-gray-800'} mb-12 shadow-2xl relative transition-all`}>
          <h2 className="text-xl font-bold mb-8 text-white flex items-center gap-2">
            {editingId ? '📝 修改項目' : '✨ 新增項目'}
          </h2>

          <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-8">
            
            {/* 服務、分類、員工、公告、商城的表單邏輯 (略縮不變) */}
            {activeTab === 'services' && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">項目名稱</label>
                  <input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">金額 (T-Dollar)</label>
                  <input type="number" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} required />
                </div>
                <div className="space-y-2 col-span-2">
                  <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">選擇分類 (從分類設定新增)</label>
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
                <input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required placeholder="如：染燙系列 / 護理產品" />
              </div>
            )}

            {activeTab === 'staff' && (
              <div className="space-y-2 col-span-2">
                <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">髮型師姓名</label>
                <input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required placeholder="如：Ivan" />
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
                  <input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required placeholder="如：資生堂鎖色洗髮水" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">所需積分 (Points)</label>
                  <input type="number" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.points} onChange={e => setFormData({...formData, points: e.target.value})} required placeholder="如：3000" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-400 uppercase tracking-widest block mb-1">圖標 (Emoji)</label>
                  <div className="flex flex-wrap gap-2 mb-3 bg-black/40 p-3 rounded-xl border border-gray-800">
                    <span className="text-xs text-gray-500 w-full mb-1">點擊快速選擇:</span>
                    {salonEmojiList.map(e => (
                      <button key={e} type="button" onClick={() => setFormData({...formData, icon: e})} className="text-2xl hover:scale-125 transition active:scale-90">{e}</button>
                    ))}
                  </div>
                  <input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.icon} onChange={e => setFormData({...formData, icon: e.target.value})} required placeholder="或自行輸入 (如：🧴)" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-400 uppercase tracking-widest block mb-1">標籤 (Tag - 選填)</label>
                  {existingTags.length > 0 && (
                     <div className="flex flex-wrap gap-2 mb-3">
                       <span className="text-xs text-gray-500 w-full mb-1">已建立的標籤:</span>
                       {existingTags.map(tag => (
                         <button key={tag} type="button" onClick={() => setFormData({...formData, tag})} className="text-xs bg-red-500/10 text-red-400 border border-red-500/30 px-3 py-1.5 rounded-full hover:bg-red-500 hover:text-white transition font-bold tracking-widest">{tag}</button>
                       ))}
                     </div>
                  )}
                  <input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.tag} onChange={e => setFormData({...formData, tag: e.target.value})} placeholder="如：VIP" />
                </div>
              </>
            )}

            {/* 🟢 增值方案專屬表單 */}
            {activeTab === 'packages' && (
              <>
                <div className="space-y-2 col-span-2">
                  <label className="text-sm font-bold text-[#D4AF37] uppercase tracking-widest">方案名稱 (顯示給客人看)</label>
                  <input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required placeholder="如：VIP 尊榮充值方案" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">向客收取金額 (HKD)</label>
                  <input type="number" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} required placeholder="如：3000" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">實得 T-Dollar (含贈金)</label>
                  <input type="number" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.tDollar} onChange={e => setFormData({...formData, tDollar: e.target.value})} required placeholder="如：3500" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">額外贈送積分 (Points)</label>
                  <input type="number" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.points} onChange={e => setFormData({...formData, points: e.target.value})} required placeholder="如：3000" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">推廣標籤 (Tag - 選填)</label>
                  {existingTags.length > 0 && (
                     <div className="flex flex-wrap gap-2 mb-3">
                       <span className="text-xs text-gray-500 w-full mb-1">已建立的標籤:</span>
                       {existingTags.map(tag => (
                         <button key={tag} type="button" onClick={() => setFormData({...formData, tag})} className="text-xs bg-red-500/10 text-red-400 border border-red-500/30 px-3 py-1.5 rounded-full hover:bg-red-500 hover:text-white transition font-bold tracking-widest">{tag}</button>
                       ))}
                     </div>
                  )}
                  <input type="text" className="w-full bg-gray-900 p-4 rounded-xl border border-gray-700 text-white focus:border-[#D4AF37] outline-none" value={formData.tag} onChange={e => setFormData({...formData, tag: e.target.value})} placeholder="如：熱賣 / 超值" />
                </div>
              </>
            )}

            <div className="flex gap-4 col-span-2 mt-4">
              <button type="submit" className="flex-1 bg-white text-black font-black py-4 rounded-2xl hover:bg-[#D4AF37] transition-all shadow-xl active:scale-95 tracking-widest">
                {editingId ? '💾 儲存修改內容' : '➕ 確認新增資料'}
              </button>
              {editingId && (
                <button type="button" onClick={() => {setEditingId(null); setFormData(initialForm);}} className="px-8 bg-gray-800 text-white font-bold rounded-2xl tracking-widest">取消</button>
              )}
            </div>
          </form>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest px-2 mb-4">現有紀錄資料表</h3>
          {list.map((item) => (
            <div key={item.id} className="bg-gray-900/60 p-6 rounded-3xl border border-gray-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 transition hover:bg-gray-900">
              <div className="flex items-center gap-5">
                <div className="w-12 h-12 rounded-2xl bg-[#D4AF37]/10 flex items-center justify-center text-2xl shrink-0">
                    {activeTab === 'services' ? '💆' : activeTab === 'staff' ? '✂️' : activeTab === 'categories' ? '🏷️' : activeTab === 'promos' ? '📢' : activeTab === 'packages' ? '💳' : (item.icon || '🎁')}
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-xl text-white">{item.name || item.title}</span>
                    {item.category && activeTab === 'services' && <span className="text-[10px] bg-white/10 text-[#D4AF37] px-2 py-0.5 rounded-md font-bold uppercase tracking-tighter">{item.category}</span>}
                    {item.tag && ['rewards', 'packages'].includes(activeTab) && <span className="text-[10px] bg-red-500/20 text-red-500 px-2 py-0.5 rounded-md font-bold uppercase tracking-tighter">{item.tag}</span>}
                  </div>
                  <div className="flex flex-wrap gap-4 mt-1 text-sm items-center">
                    {item.price && <span className="text-gray-400 font-mono font-bold text-base">{activeTab === 'packages' ? `售價 $${item.price}` : `$${item.price}`}</span>}
                    {item.tDollar && <span className="text-[#D4AF37] font-mono font-bold text-base">得 {item.tDollar} T-Dollar</span>}
                    {item.points && <span className="text-white font-mono font-bold text-base">+{item.points} PTS</span>}
                    {item.expiry && <span className="text-red-400/80 font-medium text-xs">📅 有效期: {item.expiry}</span>}
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
      </div>
    </div>
  );
}
