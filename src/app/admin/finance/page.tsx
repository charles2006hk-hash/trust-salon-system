'use client';

import React, { useState, useEffect, Suspense, useMemo } from 'react';
import { 
  collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy, writeBatch 
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
// 移除對 @/lib/logger 和 @/lib/finance 的外部依賴，避免 Vercel 找不到檔案
import { 
  DollarSign, Search, Plus, Calendar, CheckCircle, Clock, AlertCircle, 
  ArrowDownRight, ArrowUpRight, Filter, X, Loader2, Home, User, FileText, Edit, 
  TrendingUp, ArrowDownToLine, ArrowUpFromLine, Wallet, CalendarDays, CheckCircle2, Activity,
  ChevronLeft, ChevronRight, HandCoins, Users, Ban, Trash2, CreditCard, RefreshCw, Banknote, Landmark, UploadCloud, Lock, Link as LinkIcon
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';

// ============================================================================
// 財務會計運算工具 (轉為仙 Cents 整數運算，杜絕浮點數計算誤差，並內建安全運算)
// ============================================================================
const toCents = (num: number | string): number => Math.round((Number(num) || 0) * 100);
const fromCents = (cents: number): number => Number((cents / 100).toFixed(2));

const safeAdd = (a: number | string, b: number | string): number => fromCents(toCents(a) + toCents(b));
const safeSubtract = (a: number | string, b: number | string): number => fromCents(toCents(a) - toCents(b));

// 建立輕量級的日誌替代方案 (如果你沒有設定 @/lib/logger)
const logUserAction = async (action: string, module: string, details: string, refId: string) => {
  console.log(`[${action}] ${module}: ${details} (Ref: ${refId})`);
  // 如果未來有 audit_logs 集合，可以直接在這裡實作 addDoc
};

export type TransactionType = 'income' | 'expense' | 'capital_in' | 'capital_out' | 'AR' | 'AP';
export type TransactionStatus = 'pending' | 'completed' | 'voided' | 'Refunded'; 

export interface Transaction {
  id: string; 
  type: TransactionType; 
  status: TransactionStatus; 
  title: string; 
  amount: number;          
  originalAmount?: number; 
  subtotal?: number;       
  surcharge?: number;      
  dueDate: string; 
  completedDate?: string; 
  propertyId?: string; 
  roomId?: string; 
  tenantId?: string;
  remarks?: string; 
  createdAt: any; 
  category?: string;
  paidBy?: string; 
  isReimbursed?: boolean; 
  isReconciled?: boolean;  
  receiptUrl?: string;
  orderRef?: string;       
  payRef?: string;         
  paymentMethod?: string;
  paymentMethodDetail?: string; 
  subtitle?: string;
  description?: string;
}
export interface LandlordPaymentRecord { id: string; date: string; period: string; amount: number; account?: string; }
export interface PropertyFinancialRecord { id: string; date: string; item: string; amount: number; type: 'income' | 'expense'; account?: string; } 

type TabType = 'overview' | 'all' | 'receivable' | 'payable' | 'completed' | 'reimbursement' | 'reconciliation';

interface Room { id: string; propertyId: string; name: string; baseRent: number; status: 'Vacant' | 'Occupied' | 'Maintenance'; }
interface Property { 
  id: string; name: string; monthlyRent: number; landlordName: string; status: string; 
  leaseInfo?: { startDate: string; rentFreeDays: number; }; targetRent?: number; landlordPaymentFreq?: number; landlordPayments?: LandlordPaymentRecord[];
  financialRecords?: PropertyFinancialRecord[]; 
}

// ★ 修正預設資料：根據真實恒生結單修正方向與金額
const HANG_SENG_JULY_MOCK_CSV = `2026-07-02	LAM NGAI CHARLE (ZHANG LE) 通知入賬	100000.00
2026-07-07	HSHUI TRADING LIMITE 通知支賬	-45000.00
2026-07-07	YUHAO ZHOU 通知入賬	20675.00
2026-07-07	CHENG JUNHAN 通知入賬	21000.00
2026-07-07	TSUI P C 通知入賬	13400.00
2026-07-08	XUE XIAOHUI 通知入賬	13800.00
2026-07-08	MAN S Y 通知支賬	-20000.00
2026-07-09	LYU YANRAN 通知入賬	18300.00
2026-07-09	XINYUE LI 通知入賬	13200.00
2026-07-09	JIANG LIANGZHEN 通知支賬	-16500.00
2026-07-11	TSANG YING SZE 通知入賬	12400.00
2026-07-14	JINGYI WU 通知入賬	13345.00
2026-07-15	ZHANG WEIWEI 通知入賬	13800.00
2026-07-16	BIAN JUNMIN 通知支賬	-15000.00
2026-07-16	MS SHUM FUNG CHU 通知支賬	-45000.00`;

function FinanceContent() {
  const searchParams = useSearchParams();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [staffList, setStaffList] = useState<{id: string, name: string}[]>([
    { id: 'company', name: '公司官方帳戶 (預設)' }
  ]);

  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // 對帳相關狀態
  const [csvInput, setCsvInput] = useState(HANG_SENG_JULY_MOCK_CSV);
  const [bankStatement, setBankStatement] = useState<{id: string, date: string, desc: string, amount: number, matchedTxId?: string}[]>([]);
  const [manualMatchBankId, setManualMatchBankId] = useState<string | null>(null);

  useEffect(() => { setCurrentPage(1); }, [activeTab, dateRange]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Transaction>>({
    type: 'income', status: 'pending', title: '', amount: 0, dueDate: new Date().toISOString().split('T')[0],
    propertyId: '', roomId: '', tenantId: '', remarks: '', paidBy: 'company', isReimbursed: false
  });

  const [isCleanModalOpen, setIsCleanModalOpen] = useState(false);
  const [batchDeleteData, setBatchDeleteData] = useState<Transaction[]>([]);
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(new Set());

  const [selectedPayDollarTx, setSelectedPayDollarTx] = useState<Transaction | null>(null);
  const [gatewayQueryStatus, setGatewayQueryStatus] = useState<any>(null);
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const [refundInput, setRefundInput] = useState<string>('');
  const [gatewayError, setGatewayError] = useState<string>('');
  const [gatewaySuccess, setGatewaySuccess] = useState<string>('');

  useEffect(() => {
    if (!db) return;
    const unsubTrans = onSnapshot(query(collection(db, 'transactions'), orderBy('createdAt', 'desc')), snap => setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction))));
    const unsubProps = onSnapshot(collection(db, 'properties'), snap => setProperties(snap.docs.map(d => ({ id: d.id, ...d.data() } as Property))));
    const unsubRooms = onSnapshot(collection(db, 'rooms'), snap => setRooms(snap.docs.map(d => ({ id: d.id, ...d.data() } as Room))));
    const unsubTenants = onSnapshot(collection(db, 'tenants'), snap => { setTenants(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); });
    
    const unsubSettings = onSnapshot(doc(db, 'settings', 'general'), snap => {
      if (snap.exists()) {
        const data = snap.data();
        let shareholders: string[] = [];
        if (data.shareholders) {
          if (Array.isArray(data.shareholders)) shareholders = data.shareholders;
          else if (typeof data.shareholders === 'string') shareholders = data.shareholders.split(',').map((s: string) => s.trim()).filter(Boolean);
        }
        setStaffList([
          { id: 'company', name: '公司主帳戶' },
          ...shareholders.map((name: string) => ({ id: name, name: `${name} (股東代收付)` }))
        ]);
      }
    });

    const searchQ = searchParams?.get('search');
    if (searchQ) setSearchTerm(searchQ);
    
    return () => { unsubTrans(); unsubProps(); unsubRooms(); unsubTenants(); unsubSettings(); };
  }, [searchParams]);

  const propertyExpenseTransactions: Transaction[] = properties.flatMap(prop => 
    (prop.financialRecords || []).map(record => ({
      id: `prop-exp-${record.id}`, 
      type: record.type, 
      status: 'completed' as TransactionStatus, 
      title: `[${prop.name}] 前期/裝修: ${record.item}`,
      amount: record.amount,
      dueDate: record.date,
      completedDate: record.date,
      propertyId: prop.id,
      paidBy: record.account === '公司主帳戶' || record.account === '現金匣' ? 'company' : record.account, 
      isReimbursed: false, 
      createdAt: record.date, 
      remarks: '來自盤源模組的附加前期支出'
    }))
  );

  const allMergedTransactions = [...transactions, ...propertyExpenseTransactions];

  const filteredTransactions = allMergedTransactions.filter(t => {
    let matchTab = true;
    if (activeTab === 'all') matchTab = true;
    if (activeTab === 'completed') matchTab = t.status === 'completed';

    const matchSearch = searchTerm === '' || 
      (t.title || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
      (t.remarks || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.orderRef || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (t.paymentMethodDetail || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (properties.find(p => p.id === t.propertyId)?.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (tenants.find(tn => tn.id === t.tenantId)?.name || '').toLowerCase().includes(searchTerm.toLowerCase());

    let matchDate = true;
    if (dateRange.start) matchDate = matchDate && t.dueDate >= dateRange.start;
    if (dateRange.end) matchDate = matchDate && t.dueDate <= dateRange.end;

    return matchTab && matchSearch && matchDate;
  });

  const today = new Date().toISOString().split('T')[0];

  const handleExportCSV = () => {
    let csvContent = '\uFEFF'; 
    let filename = `Finance_Report_${activeTab}_${today}.csv`;

    if (activeTab === 'overview' || activeTab === 'all') {
      const dataToExport = activeTab === 'overview' ? filteredUnifiedHistory : filteredTransactions;
      if (dataToExport.length === 0) return alert("目前沒有資料可以匯出！");
      
      csvContent += "日期,項目名稱,類型,金額(HKD),付款/收款方,狀態,備註\n";
      dataToExport.forEach((t: any) => {
        const date = t.date || t.dueDate || t.completedDate || '';
        const title = `"${(t.title || '').replace(/"/g, '""')}"`;
        const typeStr = t.type === 'income' || t.type === 'AR' ? '收入' : t.type === 'expense' ? '支出' : t.type === 'capital_in' ? '股東注資' : '分紅提款';
        const amount = t.amount || 0;
        const paidBy = staffList.find(s => s.id === t.paidBy)?.name || (t.paidBy === 'company' ? '公司銀行帳戶' : (t.paidBy || '公司'));
        const status = t.status === 'completed' ? '已結清' : t.status === 'voided' ? '已作廢' : t.isReimbursed ? '已結清(報銷)' : '待處理';
        const remarks = `"${(t.remarks || '').replace(/"/g, '""')}"`;

        csvContent += `${date},${title},${typeStr},${amount},${paidBy},${status},${remarks}\n`;
      });
      filename = `Company_Ledger_${dateRange.start || 'ALL'}_to_${dateRange.end || 'ALL'}.csv`;

    } else if (activeTab === 'reimbursement') {
      const shTxs = allMergedTransactions.filter(t => t.status !== 'voided' && t.paidBy && t.paidBy !== 'company');
      if (shTxs.length === 0) return alert("目前沒有股東往來資料可以匯出！");

      csvContent += "日期,股東名稱,項目名稱,交易類型,金額(HKD),結清狀態,備註\n";
      shTxs.forEach(t => {
        const date = t.completedDate || t.dueDate || '';
        const name = staffList.find(s => s.id === t.paidBy)?.name.replace(' (股東代收付)', '') || t.paidBy;
        const title = `"${(t.title || '').replace(/"/g, '""')}"`;
        const typeStr = t.type === 'expense' ? '代墊支出 (公司欠股東)' : (t.type === 'income' || t.type === 'AR') ? '代收收入 (股東欠公司)' : t.type === 'capital_in' ? '股東注資' : '分紅提款';
        const status = t.isReimbursed ? '已結清' : '未結清 (待核銷)';
        const remarks = `"${(t.remarks || '').replace(/"/g, '""')}"`;

        csvContent += `${date},${name},${title},${typeStr},${t.amount},${status},${remarks}\n`;
      });
      filename = `Shareholder_Current_Account_${today}.csv`;
    } else {
      return alert("目前所在的分頁暫不支援直接匯出，請切換至「實際總覽報表」或「股東代墊/報銷」進行匯出。");
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const openCleanModal = () => {
    const realTransactions = filteredTransactions.filter(t => !t.id.startsWith('prop-exp-') && !t.isReconciled);
    setBatchDeleteData(realTransactions);
    setSelectedTestIds(new Set());
    setIsCleanModalOpen(true);
  };

  const handleConfirmClean = async () => {
    if (selectedTestIds.size === 0) return alert("請先選擇要刪除的資料！");
    if (!confirm(`確定要永久刪除這 ${selectedTestIds.size} 筆資料嗎？此操作無法還原。`)) return;

    setLoading(true);
    try {
      const batch = writeBatch(db);
      let deleteCount = 0;
      selectedTestIds.forEach(id => {
        batch.delete(doc(db, 'transactions', id));
        deleteCount++;
      });
      if (deleteCount > 0) {
        await batch.commit();
        alert(`✅ 成功刪除了 ${deleteCount} 筆交易紀錄！`);
      }
      setIsCleanModalOpen(false);
    } catch (error) {
      alert("❌ 刪除失敗，請檢查權限。");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (record: Transaction) => {
    if (record.isReconciled) return alert("已對帳鎖定的紀錄無法刪除！");
    if (!confirm(`確定要「永久刪除」這筆紀錄 [${record.title}] 嗎？`)) return;
    try {
      await deleteDoc(doc(db, 'transactions', record.id));
      await logUserAction('DELETE', 'Finance_Transaction', `刪除了財務紀錄 [${record.title}], 金額: $${record.amount}`, record.id); 
    } catch (e) {
      alert("刪除失敗。");
    }
  };

  const toggleTestSelection = (id: string) => {
    const newSet = new Set(selectedTestIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedTestIds(newSet);
  };

  const openModal = (record?: Transaction) => {
    if (record?.isReconciled) return alert("已對帳的資料被會計鎖定，無法編輯。");
    if (record) { setEditingId(record.id); setFormData(record); } 
    else { setEditingId(null); setFormData({ type: 'income', status: 'pending', title: '', amount: 0, dueDate: new Date().toISOString().split('T')[0], propertyId: '', roomId: '', tenantId: '', remarks: '', paidBy: 'company', isReimbursed: false }); }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.amount || !formData.dueDate) return alert("請填寫必填欄位！");
    setIsSaving(true);
    try {
      const payload = { ...formData, amount: Number(formData.amount) };
      if (payload.paidBy && payload.paidBy !== 'company') {
        payload.status = 'completed';
        if (!payload.completedDate) payload.completedDate = payload.dueDate;
      } else if (payload.status === 'completed' && !payload.completedDate) {
        payload.completedDate = new Date().toISOString().split('T')[0];
      }

      if (editingId) {
        await updateDoc(doc(db, 'transactions', editingId), { ...payload, updatedAt: serverTimestamp() });
        await logUserAction('UPDATE', 'Finance_Transaction', `更新了財務紀錄 [${payload.title}], 金額: $${payload.amount}`, editingId); 
      } else {
        const docRef = await addDoc(collection(db, 'transactions'), { ...payload, createdAt: serverTimestamp() });
        await logUserAction('CREATE', 'Finance_Transaction', `新增了財務紀錄 [${payload.title}], 金額: $${payload.amount}`, docRef.id); 
      }
      setIsModalOpen(false);
    } catch (error) { alert("❌ 儲存失敗"); } finally { setIsSaving(false); }
  };

  const handleVoid = async (record: Transaction) => {
    if (record.isReconciled) return alert("已對帳鎖定的紀錄無法作廢！");
    if (!confirm(`確定要「作廢」這筆紀錄 [${record.title}] 嗎？`)) return;
    try {
      await updateDoc(doc(db, 'transactions', record.id), { status: 'voided', updatedAt: serverTimestamp() });
      await logUserAction('VOID', 'Finance_Transaction', `作廢了財務紀錄 [${record.title}], 原金額: $${record.amount}`, record.id); 
    } catch (e) { alert("操作失敗"); }
  };

  const handleToggleStatus = async (record: Transaction) => {
    if (record.status === 'voided' || record.isReconciled) return; 
    const newStatus = record.status === 'pending' ? 'completed' : 'pending';
    const payload: any = { status: newStatus, updatedAt: serverTimestamp() };
    if (newStatus === 'completed') payload.completedDate = new Date().toISOString().split('T')[0];
    else payload.completedDate = null;
    await updateDoc(doc(db, 'transactions', record.id), payload);
    await logUserAction('UPDATE', 'Finance_Transaction', `變更了紀錄狀態 [${record.title}] 為 ${newStatus}`, record.id); 
  };

  const handleReimburse = async (trans: Transaction) => {
    let actionText = '';
    let remarkText = '';
    if (trans.type === 'expense') { actionText = `確定公司已將 $${trans.amount.toLocaleString()} 還給墊付者？`; remarkText = '公司已完成還款'; }
    else if (trans.type === 'income' || trans.type === 'AR') { actionText = `確定代收者已將 $${trans.amount.toLocaleString()} 上繳回公司主帳戶？`; remarkText = '代收已上繳公司'; }
    else if (trans.type === 'capital_in') { actionText = `確定公司已將 $${trans.amount.toLocaleString()} 的注資款退還給該股東？`; remarkText = '公司已退回注資'; }
    else { actionText = `確定該股東已將 $${trans.amount.toLocaleString()} 款項繳回給公司？`; remarkText = '股東已繳回款項'; }

    if (!confirm(actionText + '\n標記後，此筆股東往來帳務將正式結清。')) return;
    try {
      await updateDoc(doc(db, 'transactions', trans.id), {
        isReimbursed: true,
        remarks: (trans.remarks || '') + ` [${remarkText}於 ${new Date().toLocaleDateString()}]`,
        updatedAt: serverTimestamp()
      });
      await logUserAction('REIMBURSE', 'Finance_Reimbursement', `${remarkText}, 項目: [${trans.title}], 金額: $${trans.amount}`, trans.id); 
    } catch (e) { alert("操作失敗"); }
  };

  const handleRecordLandlordPayment = async (prop: Property) => {
    const freq = prop.landlordPaymentFreq || 1;
    const amount = (prop.monthlyRent || 0) * freq;
    if (amount <= 0) return alert("該物業尚未設定大業主租金成本！");
    if (!confirm(`確定要記錄一筆打款給大業主 [${prop.landlordName || '未知'}]？\n系統計算金額: $${amount.toLocaleString()}`)) return;
    try {
      const newPayment: LandlordPaymentRecord = { id: Math.random().toString(36).substring(2, 9), date: new Date().toISOString().split('T')[0], period: '最新期租金打款', amount: amount, account: '公司主帳戶' };
      const updatedPayments = [...(prop.landlordPayments || []), newPayment];
      await updateDoc(doc(db, 'properties', prop.id), { landlordPayments: updatedPayments });
      await logUserAction('CREATE', 'Finance_LandlordPayment', `記錄了大業主打款 [${prop.name}], 金額: $${amount}`, prop.id); 
      alert("✅ 成功記錄大業主打款！");
    } catch (error) { alert("❌ 記錄失敗。"); }
  };

  // ============================================================================
  // ★ 銀行對帳模組 (Bank Reconciliation) 核心邏輯
  // ============================================================================
  const handleParseCsv = () => {
    try {
      const rows = csvInput.trim().split('\n');
      const parsed = rows.map((row, i) => {
        const cols = row.split('\t');
        if (cols.length < 3) return null;
        return {
          id: `bank-${Date.now()}-${i}`,
          date: cols[0].trim(),
          desc: cols[1].trim(),
          amount: parseFloat(cols[2].trim().replace(/,/g, '')),
        };
      }).filter(Boolean) as any[];
      setBankStatement(parsed);
      alert(`✅ 成功載入 ${parsed.length} 筆銀行結單資料！\n\n提示：您現在可以直接在下方表格中點擊並修改任何不精確的日期或金額。`);
    } catch (e) {
      alert("載入失敗，請確認格式為: YYYY-MM-DD [Tab] 描述 [Tab] 金額");
    }
  };

  // ★ 支援手動修改導入的結單內容
  const handleEditBankStatement = (id: string, field: string, value: string | number) => {
    setBankStatement(prev => prev.map(b => b.id === id ? { ...b, [field]: value } : b));
  };

  const handleAddBankRow = () => {
    setBankStatement([{ id: `bank-manual-${Date.now()}`, date: today, desc: '手動新增交易', amount: 0 }, ...bankStatement]);
  };

  const handleRemoveBankRow = (id: string) => {
    setBankStatement(prev => prev.filter(b => b.id !== id));
  };

  const unreconciledSysTxs = useMemo(() => {
    return allMergedTransactions.filter(t => 
      t.status === 'completed' && 
      !t.isReconciled && 
      (!t.paidBy || t.paidBy === 'company') 
    );
  }, [allMergedTransactions]);

  const handleAutoMatch = () => {
    let matchCount = 0;
    const newStatement = [...bankStatement];
    const sysTxsToUpdate: {id: string, bankDesc: string}[] = [];

    newStatement.forEach(bankTx => {
      if (bankTx.matchedTxId) return;
      
      const potentialMatch = unreconciledSysTxs.find(sysTx => {
        if (sysTxsToUpdate.find(u => u.id === sysTx.id)) return false;
        
        const sysCents = toCents(sysTx.amount);
        const bankCents = toCents(Math.abs(bankTx.amount));
        const isSysIncome = sysTx.type === 'income' || sysTx.type === 'AR' || sysTx.type === 'capital_in';
        const isBankIncome = bankTx.amount > 0;

        return sysCents === bankCents && isSysIncome === isBankIncome;
      });

      if (potentialMatch) {
        bankTx.matchedTxId = potentialMatch.id;
        sysTxsToUpdate.push({ id: potentialMatch.id, bankDesc: bankTx.desc });
        matchCount++;
      }
    });

    setBankStatement(newStatement);
    if (matchCount > 0) alert(`🤖 智能金額配對完成！成功比對 ${matchCount} 筆交易。請點擊「確認入帳鎖定」寫入系統。`);
    else alert(`無符合金額的系統交易可比對。`);
  };

  // ★ 手動配對與解除配對
  const handleManualMatch = (bankId: string, sysId: string) => {
    setBankStatement(prev => prev.map(b => b.id === bankId ? { ...b, matchedTxId: sysId } : b));
    setManualMatchBankId(null);
  };

  const handleUnmatch = (bankId: string) => {
    setBankStatement(prev => prev.map(b => b.id === bankId ? { ...b, matchedTxId: undefined } : b));
  };

  const confirmReconciliation = async () => {
    const matchedBankTxs = bankStatement.filter(b => b.matchedTxId);
    if (matchedBankTxs.length === 0) return alert("沒有已配對的項目需要核銷！");

    if (!confirm(`確定要將這 ${matchedBankTxs.length} 筆交易標記為「已核銷 (Reconciled)」？\n鎖定後將無法刪除或作廢。`)) return;

    setLoading(true);
    try {
      const batch = writeBatch(db);
      matchedBankTxs.forEach(bankTx => {
        if (!bankTx.matchedTxId) return;
        if (!bankTx.matchedTxId.startsWith('prop-exp-')) {
          const ref = doc(db, 'transactions', bankTx.matchedTxId);
          batch.update(ref, { 
            isReconciled: true, 
            remarks: `[已與銀行對帳: ${bankTx.desc}]`,
            updatedAt: serverTimestamp() 
          });
        }
      });
      await batch.commit();
      
      setBankStatement(prev => prev.filter(b => !b.matchedTxId));
      alert("✅ 核銷成功！系統已將帳目安全鎖定。");
    } catch (e) {
      alert("核銷寫入失敗。");
    } finally {
      setLoading(false);
    }
  };

  const occupiedRooms = rooms.filter(r => r.status === 'Occupied');
  
  const expectedReceivables = properties.reduce((acc, p) => {
    let expected = Number(p.targetRent) || 0;
    if (expected === 0) { 
      const pRooms = occupiedRooms.filter(r => r.propertyId === p.id); 
      expected = pRooms.reduce((sum, r) => safeAdd(sum, Number(r.baseRent) || 0), 0); 
    }
    return safeAdd(acc, expected);
  }, 0);

  const activeProperties = properties.filter(p => ['收租中', '裝修中', '準備狀態'].includes(p.status));
  const expectedPayables = activeProperties.reduce((sum, prop) => safeAdd(sum, prop.monthlyRent || 0), 0);
  
  const grossMargin = safeSubtract(expectedReceivables, expectedPayables);
  const marginPercentage = expectedReceivables > 0 ? ((grossMargin / expectedReceivables) * 100).toFixed(1) : '0.0';

  const netShareholderBalance = allMergedTransactions
    .filter(t => t.status !== 'voided' && t.paidBy && t.paidBy !== 'company' && !t.isReimbursed)
    .reduce((sum, t) => {
       if (t.type === 'expense' || t.type === 'capital_in') return safeAdd(sum, t.amount);
       if (t.type === 'income' || t.type === 'AR' || t.type === 'capital_out') return safeSubtract(sum, t.amount);
       return sum as number;
    }, 0) as number;

  const allUnifiedHistory = [
    ...allMergedTransactions.filter(t => t.status === 'completed').map(t => {
      const safeDate = t.completedDate || t.dueDate || (t as any).date || 
        (typeof t.createdAt === 'string' ? t.createdAt.split('T')[0] : '') || 
        (t.createdAt?.toDate ? t.createdAt.toDate().toISOString().split('T')[0] : '') || 
        new Date().toISOString().split('T')[0];

      return {
        id: t.id, 
        date: safeDate, 
        title: t.isReimbursed ? `${t.title} (已結清)` : t.title, 
        amount: t.amount, 
        type: t.type, 
        source: 'transaction', 
        ref: t.propertyId || '',
        paidBy: t.paidBy || 'company'
      };
    }),
    ...properties.flatMap(p => (p.landlordPayments || []).map(pay => ({
      id: pay.id, date: pay.date, title: `大業主打款 (${p.name})`, amount: pay.amount, type: 'expense' as TransactionType, source: 'landlord', ref: p.id, paidBy: 'company'
    })))
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const filteredUnifiedHistory = allUnifiedHistory.filter(rec => {
    let match = true;
    if (dateRange.start) match = match && rec.date >= dateRange.start;
    if (dateRange.end) match = match && rec.date <= dateRange.end;
    return match;
  });

  const totalPages = Math.ceil(filteredUnifiedHistory.length / itemsPerPage);
  const paginatedHistory = filteredUnifiedHistory.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const actualIncome = filteredUnifiedHistory.filter(t => t.type === 'income' || t.type === 'AR').reduce((sum, t) => safeAdd(sum, t.amount), 0) as number;
  const totalActualExpense = filteredUnifiedHistory.filter(t => t.type === 'expense').reduce((sum, t) => safeAdd(sum, t.amount), 0) as number;
  const actualNetProfit = safeSubtract(actualIncome, totalActualExpense);

  const getRealPaymentStatus = (room: Room) => {
    const tenant = tenants.find(t => t.roomId === room.id || (t.propertyId === room.propertyId && t.roomName === room.name));
    if (!tenant) return { status: 'vacant', label: '待出租', color: 'slate' };
    const isTenantPaid = (tenant.amountDue || 0) <= 0 && !tenant.hasUnpaidBills;
    const hasCompletedTx = transactions.some(t => t.tenantId === tenant.id && (t.type === 'income' || t.type === 'AR') && t.status === 'completed');

    if (isTenantPaid || hasCompletedTx) return { status: 'paid', label: '已繳費', color: 'emerald' };
    if (tenant.hasUnpaidBills || (tenant.amountDue || 0) > 0) return { status: 'overdue', label: '已逾期', color: 'red' };
    return { status: 'pending', label: '待繳費', color: 'amber' };
  };

  const setFiscalYear = (year: number) => {
    setDateRange({ start: `${year}-01-01`, end: `${year}-12-31` });
  };

  return (
    <div className="min-h-full flex flex-col animate-in fade-in duration-300 relative bg-slate-50">
      
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center p-6 pb-2 gap-4 flex-none">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Wallet className="text-blue-600" size={28}/> 資產財務結算中心
          </h2>
          <p className="text-sm text-slate-500 font-medium mt-1">追蹤預期收租、大業主應付帳款、股東墊付、及銀行對帳。</p>
        </div>
        
        <div className="flex gap-2">
          <button onClick={handleExportCSV} className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-4 py-2 rounded-lg font-bold flex items-center shadow-sm hover:bg-emerald-100 transition active:scale-95 text-sm">
            <ArrowDownToLine size={18} className="mr-1" /> 匯出 Excel (CSV)
          </button>
          <button onClick={openCleanModal} className="bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-lg font-bold flex items-center shadow-sm hover:bg-red-100 transition active:scale-95 text-sm">
            批次刪除 / 清理
          </button>
          <button onClick={() => openModal()} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold flex items-center shadow-md hover:bg-blue-700 transition active:scale-95 text-sm">
            <Plus size={18} className="mr-1" /> 新增自由帳單/紀錄
          </button>
        </div>
      </div>

      {/* 4 顆主財務卡片 */}
      <div className="px-6 grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4 flex-none">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between cursor-pointer hover:border-blue-300 transition-colors" onClick={() => setActiveTab('receivable')}>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">本月預期應收</p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black text-slate-800">${expectedReceivables.toLocaleString()}</span>
            </div>
            <p className="text-xs font-bold text-emerald-600 mt-1 flex items-center"><TrendingUp size={12} className="mr-1"/> {occupiedRooms.length} 間房</p>
          </div>
          <div className="hidden sm:flex w-10 h-10 rounded-full bg-emerald-50 items-center justify-center text-emerald-600"><ArrowDownToLine size={20}/></div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between cursor-pointer hover:border-red-300 transition-colors" onClick={() => setActiveTab('payable')}>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">本期預期應付</p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black text-slate-800">${expectedPayables.toLocaleString()}</span>
            </div>
            <p className="text-xs font-bold text-red-500 mt-1 flex items-center"><FileText size={12} className="mr-1"/> {activeProperties.length} 個物業</p>
          </div>
          <div className="hidden sm:flex w-10 h-10 rounded-full bg-red-50 items-center justify-center text-red-600"><ArrowUpFromLine size={20}/></div>
        </div>

        <div className="bg-orange-50 p-5 rounded-2xl border border-orange-200 shadow-sm flex items-center justify-between cursor-pointer hover:border-orange-400 transition-colors" onClick={() => setActiveTab('reimbursement')}>
          <div>
            <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest mb-1">股東往來淨額 (代收/墊付)</p>
            <div className="flex items-baseline gap-1">
              <span className={`text-xl font-black ${netShareholderBalance > 0 ? 'text-red-600' : netShareholderBalance < 0 ? 'text-emerald-600' : 'text-orange-700'}`}>
                 {netShareholderBalance > 0 ? `公司欠股東 $${Math.abs(netShareholderBalance).toLocaleString()}` :
                  netShareholderBalance < 0 ? `股東欠公司 $${Math.abs(netShareholderBalance).toLocaleString()}` : '$0'}
              </span>
            </div>
            <p className="text-xs font-bold text-orange-500 mt-1 flex items-center"><Users size={12} className="mr-1"/> 會計隔離不入銀行帳</p>
          </div>
          <div className="hidden sm:flex w-10 h-10 rounded-full bg-white items-center justify-center text-orange-500 shadow-sm"><HandCoins size={20}/></div>
        </div>

        <div className="bg-slate-900 p-5 rounded-2xl shadow-lg flex items-center justify-between relative overflow-hidden cursor-pointer hover:shadow-xl transition-shadow" onClick={() => setActiveTab('overview')}>
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/20 blur-2xl -translate-y-10 translate-x-10 pointer-events-none" />
          <div className="relative z-10">
            <p className="text-[10px] font-black text-blue-300 uppercase tracking-widest mb-1">預估單月總毛利</p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black text-white">${grossMargin.toLocaleString()}</span>
            </div>
            <p className="text-xs font-bold text-blue-200 mt-1">毛利率: {marginPercentage}%</p>
          </div>
        </div>
      </div>

      {/* 導航分籤與過濾區 */}
      <div className="px-6 mb-4 flex-none space-y-3">
        <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1">
          {[
            { id: 'overview', label: '實際總覽報表', icon: <TrendingUp size={14}/> },
            { id: 'receivable', label: '本月收租 (AR)', icon: <ArrowDownRight size={14}/> },
            { id: 'payable', label: '業主付租 (AP)', icon: <ArrowUpRight size={14}/> },
            { id: 'reimbursement', label: '股東代墊/報銷', icon: <HandCoins size={14}/> },
            { id: 'all', label: '全部帳目管理', icon: <FileText size={14}/> },
            { id: 'reconciliation', label: '銀行對帳 (Reconciliation)', icon: <Landmark size={14}/> },
          ].map(tab => (
            <button 
              key={tab.id} onClick={() => { setActiveTab(tab.id as TabType); setSearchTerm(''); }}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-bold whitespace-nowrap transition-colors border shadow-sm ${activeTab === tab.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          {['all', 'receivable', 'payable', 'reimbursement'].includes(activeTab) && (
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={16}/>
              <input 
                type="text" placeholder={activeTab === 'all' ? "搜尋項目、支付渠道、網關號..." : "搜尋房間、物業名稱..."} 
                value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
              />
              {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"><X size={16}/></button>}
            </div>
          )}
          {['all', 'overview'].includes(activeTab) && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 border border-slate-200 rounded-xl shadow-sm w-fit">
                <Filter size={14} className="text-blue-500"/>
                <span className="text-xs font-black text-slate-600">區間:</span>
                <input type="date" value={dateRange.start} onChange={e => setDateRange({...dateRange, start: e.target.value})} className="text-xs font-mono font-bold border-none outline-none bg-transparent text-slate-700"/>
                <span className="text-slate-300">-</span>
                <input type="date" value={dateRange.end} onChange={e => setDateRange({...dateRange, end: e.target.value})} className="text-xs font-mono font-bold border-none outline-none bg-transparent text-slate-700"/>
                {(dateRange.start || dateRange.end) && <button onClick={() => setDateRange({start: '', end: ''})} className="text-slate-400 hover:text-red-500 ml-1 bg-red-50 p-1 rounded-full"><X size={12}/></button>}
              </div>
              <div className="flex bg-slate-200 p-1 rounded-lg gap-1">
                <button onClick={() => setFiscalYear(2025)} className="text-[10px] font-bold px-2 py-1 bg-white rounded shadow-sm text-slate-600">2025財年</button>
                <button onClick={() => setFiscalYear(2026)} className="text-[10px] font-bold px-2 py-1 bg-white rounded shadow-sm text-slate-600">2026財年</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex justify-center items-center"><Loader2 className="animate-spin text-blue-600" size={40} /></div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 pb-10 custom-scrollbar">
          
          {/* ========================================================= */}
          {/* ★ 銀行對帳模組 (Bank Reconciliation) - 支援修改與手動配對 */}
          {/* ========================================================= */}
          {activeTab === 'reconciliation' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-start gap-3">
                  <Landmark className="text-blue-600 shrink-0 mt-0.5" size={18}/>
                  <div>
                    <p className="text-sm font-black text-blue-900">會計師專用：銀行結單對帳 (Bank Reconciliation)</p>
                    <p className="text-xs font-medium text-blue-700 mt-1">
                      將銀行輸出的 CSV 或 Excel 明細貼入下方。系統將自動過濾掉「股東代收支」的款項，只比對公司銀行戶口的流水，確保期末結餘精確無誤。
                    </p>
                  </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                
                {/* 左側：上傳 / 貼上結單區 (全表格自訂修改) */}
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col h-[600px]">
                  <div className="p-3 border-b bg-slate-50 flex justify-between items-center">
                    <span className="font-bold text-sm text-slate-700">1. 貼上銀行 CSV/Excel 明細</span>
                    <button onClick={handleParseCsv} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center shadow-sm hover:bg-slate-700">
                      <UploadCloud size={14} className="mr-1"/> 重新載入數據
                    </button>
                  </div>
                  <div className="p-3 bg-slate-50 border-b">
                    <textarea 
                      value={csvInput} 
                      onChange={(e) => setCsvInput(e.target.value)} 
                      className="w-full h-16 p-2 text-[10px] font-mono border rounded outline-none focus:border-blue-400 bg-white whitespace-pre"
                      placeholder="請貼上 Excel 資料，格式：日期 [Tab] 描述 [Tab] 金額"
                    />
                  </div>
                  <div className="flex-1 overflow-y-auto pb-3 custom-scrollbar">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-white sticky top-0 shadow-sm z-10">
                        <tr>
                          <th className="py-2 pl-3 text-slate-400 w-24">日期</th>
                          <th className="py-2 text-slate-400">銀行摘要</th>
                          <th className="py-2 text-right text-slate-400 w-28">金額</th>
                          <th className="py-2 text-center text-slate-400 w-24">狀態/操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {bankStatement.length === 0 && <tr><td colSpan={4} className="text-center py-10 text-slate-300">請先載入結單數據</td></tr>}
                        {bankStatement.map(b => (
                          <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                            <td className="py-1.5 pl-3">
                              <input 
                                type="date" 
                                value={b.date} 
                                onChange={(e) => handleEditBankStatement(b.id, 'date', e.target.value)}
                                className="w-24 text-[11px] font-mono bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none"
                              />
                            </td>
                            <td className="py-1.5">
                              <input 
                                type="text" 
                                value={b.desc} 
                                onChange={(e) => handleEditBankStatement(b.id, 'desc', e.target.value)}
                                className="w-full text-[11px] font-bold bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input 
                                type="number" 
                                value={b.amount} 
                                onChange={(e) => handleEditBankStatement(b.id, 'amount', parseFloat(e.target.value) || 0)}
                                className={`w-full text-right text-[11px] font-mono font-bold bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 outline-none ${b.amount > 0 ? 'text-emerald-600' : 'text-red-600'}`}
                              />
                            </td>
                            <td className="py-1.5 text-center flex items-center justify-center gap-1">
                              {b.matchedTxId ? (
                                <div className="flex items-center gap-1">
                                  <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold text-[9px]">已配對</span>
                                  <button onClick={() => handleUnmatch(b.id)} className="text-red-400 hover:text-red-600 bg-red-50 rounded px-1 py-0.5" title="解除配對"><X size={12}/></button>
                                </div>
                              ) : (
                                <>
                                  <button onClick={() => setManualMatchBankId(b.id)} className="bg-blue-100 text-blue-700 hover:bg-blue-200 px-1.5 py-0.5 rounded font-bold text-[9px] transition">配對</button>
                                  <button onClick={() => handleRemoveBankRow(b.id)} className="text-slate-300 hover:text-red-500" title="刪除此列"><Trash2 size={12}/></button>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="p-3 text-center">
                       <button onClick={handleAddBankRow} className="text-[10px] font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors flex items-center justify-center mx-auto gap-1">
                          <Plus size={12}/> 新增一列 (Add Row)
                       </button>
                    </div>
                  </div>
                </div>

                {/* 右側：系統待核銷帳目 */}
                <div className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col h-[600px]">
                  <div className="p-3 border-b bg-blue-50 border-blue-100 flex justify-between items-center">
                    <span className="font-bold text-sm text-blue-900">2. 系統未核銷帳目 (Company Only)</span>
                    <div className="flex gap-2">
                      <button onClick={handleAutoMatch} disabled={bankStatement.length === 0} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center shadow-sm hover:bg-blue-700 disabled:opacity-50">
                        智能金額配對
                      </button>
                      <button onClick={confirmReconciliation} disabled={!bankStatement.some(b => b.matchedTxId)} className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center shadow-sm hover:bg-emerald-700 disabled:opacity-50">
                        <Lock size={14} className="mr-1"/> 確認入帳鎖定
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-white sticky top-0 shadow-sm z-10">
                        <tr><th className="py-2 text-slate-400">日期</th><th className="py-2 text-slate-400">系統單據</th><th className="py-2 text-right text-slate-400">金額</th><th className="py-2 text-center text-slate-400 w-16">配對</th></tr>
                      </thead>
                      <tbody>
                        {unreconciledSysTxs.length === 0 && <tr><td colSpan={4} className="text-center py-10 text-slate-300">太棒了！所有公司帳目皆已核銷。</td></tr>}
                        {unreconciledSysTxs.map(t => {
                          const isIncome = t.type === 'income' || t.type === 'AR' || t.type === 'capital_in';
                          const isMatched = bankStatement.some(b => b.matchedTxId === t.id);
                          return (
                            <tr key={t.id} className={`border-b border-slate-50 transition-colors ${isMatched ? 'bg-emerald-50/50 opacity-50' : 'hover:bg-slate-50'}`}>
                              <td className="py-2 font-mono text-slate-500">{t.completedDate || t.dueDate}</td>
                              <td className="py-2 font-bold text-slate-700 truncate max-w-[150px]">{t.title}</td>
                              <td className={`py-2 text-right font-mono font-bold ${isIncome ? 'text-emerald-600' : 'text-red-600'}`}>
                                {isIncome ? '+' : '-'}{t.amount.toLocaleString()}
                              </td>
                              <td className="py-2 text-center">
                                {isMatched ? <CheckCircle2 size={14} className="text-emerald-500 mx-auto"/> : <span className="text-[10px] text-slate-400">待配對</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* TAB: 實際總覽報表 (P&L) */}
          {activeTab === 'overview' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-2xl flex flex-col justify-center shadow-sm">
                  <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1 flex items-center"><CheckCircle2 size={12} className="mr-1"/>區間實際總收入</p>
                  <p className="text-3xl font-black text-emerald-800 font-mono">${actualIncome.toLocaleString()}</p>
                </div>
                <div className="bg-red-50 border border-red-200 p-6 rounded-2xl flex flex-col justify-center shadow-sm">
                  <p className="text-[10px] font-black text-red-600 uppercase tracking-widest mb-1 flex items-center"><AlertCircle size={12} className="mr-1"/>區間實際總支出 (含打款與裝修)</p>
                  <p className="text-3xl font-black text-red-800 font-mono">${totalActualExpense.toLocaleString()}</p>
                </div>
                <div className="bg-white border border-slate-200 p-6 rounded-2xl flex flex-col justify-center shadow-sm relative overflow-hidden">
                  {actualNetProfit >= 0 ? <div className="absolute top-0 right-0 w-16 h-16 bg-blue-100 rounded-bl-full pointer-events-none"/> : <div className="absolute top-0 right-0 w-16 h-16 bg-red-100 rounded-bl-full pointer-events-none"/>}
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 flex items-center relative z-10"><Wallet size={12} className="mr-1"/>區間實際淨利潤</p>
                  <p className={`text-3xl font-black font-mono relative z-10 ${actualNetProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>${actualNetProfit.toLocaleString()}</p>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity size={18} className="text-blue-500"/>
                    <h3 className="font-black text-sm text-slate-800">現金流軌跡紀錄 <span className="text-xs font-normal text-slate-500 ml-2">(共 {filteredUnifiedHistory.length} 筆)</span></h3>
                  </div>
                </div>
                
                {filteredUnifiedHistory.length === 0 ? (
                  <div className="p-10 text-center text-slate-400 font-bold">此區間沒有任何已結清的帳款或資金流動紀錄。</div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead className="bg-white text-slate-400 text-[10px] uppercase font-black tracking-widest border-b border-slate-200">
                          <tr><th className="p-3 pl-5 w-32">日期</th><th className="p-3">項目與來源</th><th className="p-3 text-right pr-5 w-40">金額</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {paginatedHistory.map((rec, idx) => {
                            const isPositive = rec.type === 'income' || rec.type === 'AR' || rec.type === 'capital_in';
                            const displayName = staffList.find(s => s.id === rec.paidBy)?.name.replace(' (股東代收付)', '') || '公司';
                            
                            return (
                              <tr key={`${rec.id}-${idx}`} className="hover:bg-slate-50 transition-colors">
                                <td className="p-3 pl-5 font-mono text-xs text-slate-500">{rec.date}</td>
                                <td className="p-3">
                                  <div className="flex items-center gap-2">
                                     <p className="font-bold text-sm text-slate-800">{rec.title}</p>
                                     {rec.type === 'capital_in' && <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-bold">股東注資</span>}
                                     {rec.type === 'capital_out' && <span className="text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold">股東提款</span>}
                                  </div>
                                  <div className="mt-1 flex gap-1">
                                    {rec.source === 'landlord' && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded inline-block">ERP 業主打款</span>}
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded inline-block font-bold ${rec.paidBy && rec.paidBy !== 'company' ? 'bg-orange-50 text-orange-700 border border-orange-200' : 'bg-slate-100 text-slate-600 border border-slate-200'}`}>
                                      {rec.paidBy && rec.paidBy !== 'company' ? `股東代收/支: ${displayName}` : '公司帳戶'}
                                    </span>
                                  </div>
                                </td>
                                <td className={`p-3 pr-5 text-right font-mono font-black ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {isPositive ? '+' : '-'}${rec.amount.toLocaleString()}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="p-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs font-bold text-slate-500">
                      <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-3 py-1.5 rounded-lg flex items-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-200 text-slate-700">
                        <ChevronLeft size={16} className="mr-1"/> 上一頁
                      </button>
                      <span className="font-mono">第 {currentPage} 頁 / 共 {totalPages || 1} 頁</span>
                      <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0} className="px-3 py-1.5 rounded-lg flex items-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-200 text-slate-700">
                        下一頁 <ChevronRight size={16} className="ml-1"/>
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* TAB: 股東代墊/報銷 */}
         {activeTab === 'reimbursement' && (() => {
            const shareholderBalances = staffList.filter(s => s.id !== 'company').map(staff => {
              const amount = allMergedTransactions
                .filter(t => t.status !== 'voided' && t.paidBy === staff.id && !t.isReimbursed)
                .reduce((sum, t) => {
                   if (t.type === 'expense' || t.type === 'capital_in') return safeAdd(sum, t.amount);
                   if (t.type === 'income' || t.type === 'AR' || t.type === 'capital_out') return safeSubtract(sum, t.amount);
                   return sum as number;
                }, 0) as number;
              return { name: staff.name.replace(' (股東代收付)', ''), amount };
            }).filter(s => s.amount !== 0);

            return (
            <div className="space-y-4 animate-in fade-in">
              <div className="bg-orange-50 p-4 rounded-xl border border-orange-100 flex items-start gap-3">
                  <AlertCircle className="text-orange-500 shrink-0 mt-0.5" size={18}/>
                  <div>
                    <p className="text-sm font-black text-orange-800">股東往來帳 (代墊、代收與資金流動)</p>
                    <p className="text-xs font-medium text-orange-700 mt-1">包含手動輸入的自由帳單，以及盤源模組中由股東代墊的前期裝修支出。結清後此帳務即歸零。</p>
                  </div>
              </div>

              {shareholderBalances.length > 0 && (
                <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-2">
                  {shareholderBalances.map(sb => (
                    <div key={sb.name} className={`bg-white border p-3 rounded-xl shadow-sm min-w-[160px] flex-shrink-0 ${sb.amount > 0 ? 'border-red-200' : 'border-emerald-200'}`}>
                      <p className="text-[10px] font-bold text-slate-500 mb-1">{sb.amount > 0 ? '公司待還給' : '待上繳公司'}</p>
                      <p className="text-sm font-black text-slate-800">{sb.name}</p>
                      <p className={`text-lg font-mono font-black mt-1 ${sb.amount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                         ${Math.abs(sb.amount).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase font-black border-b border-slate-200">
                    <tr><th className="p-4 pl-5">成員</th><th className="p-4">項目/備註</th><th className="p-4 w-32">類型</th><th className="p-4 text-right w-32">金額</th><th className="p-4 text-center w-36">結清操作</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {allMergedTransactions.filter(t => t.status !== 'voided' && t.paidBy && t.paidBy !== 'company').map(t => {
                      if (searchTerm && !t.title.toLowerCase().includes(searchTerm.toLowerCase())) return null;
                      const isOwedByCompany = t.type === 'expense' || t.type === 'capital_in';
                      const displayName = staffList.find(s => s.id === t.paidBy)?.name.replace(' (股東代收付)', '') || t.paidBy || '未知';
                      const isFromProperty = t.id.startsWith('prop-exp-');

                      return (
                        <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                          <td className="p-4 pl-5">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200">
                              <Users size={12}/> {displayName}
                            </span>
                          </td>
                          <td className="p-4">
                            <p className="text-sm font-bold text-slate-800">{t.title}</p>
                            {t.remarks && <p className="text-[10px] text-slate-400 mt-1 line-clamp-1" title={t.remarks}>{t.remarks}</p>}
                          </td>
                          <td className="p-4">
                            <span className={`text-[10px] px-2 py-1 rounded font-bold border ${isOwedByCompany ? 'bg-red-50 text-red-600 border-red-200' : 'bg-emerald-50 text-emerald-600 border-emerald-200'}`}>
                              {t.type === 'expense' ? '代墊支出 (欠他)' : (t.type === 'income' || t.type === 'AR') ? '代收收入 (他欠)' : t.type === 'capital_in' ? '股東注資 (欠他)' : '分紅提款 (他欠)'}
                            </span>
                          </td>
                          <td className={`p-4 text-right font-black font-mono ${isOwedByCompany ? 'text-red-600' : 'text-emerald-600'}`}>
                            ${t.amount.toLocaleString()}
                          </td>
                          <td className="p-4 text-center">
                            {t.isReimbursed ? (
                              <span className="text-[10px] font-black px-2 py-1 bg-slate-100 text-slate-500 rounded-lg flex items-center justify-center gap-1 border border-slate-200">
                                <CheckCircle2 size={12}/> 已結清
                              </span>
                            ) : isFromProperty ? (
                              <span className="text-[10px] font-bold px-2 py-1 text-amber-600 bg-amber-50 rounded-lg border border-amber-200 block text-center">
                                請至盤源修改
                              </span>
                            ) : (
                              <button onClick={() => handleReimburse(t)} className={`text-[10px] font-black px-3 py-1.5 text-white rounded-lg transition-colors shadow-sm active:scale-95 ${isOwedByCompany ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}>
                                {t.type === 'expense' ? '確認公司已還' : (t.type === 'income' || t.type === 'AR') ? '確認已上繳' : t.type === 'capital_in' ? '退回注資款' : '確認已繳回'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {allMergedTransactions.filter(t => t.status !== 'voided' && t.paidBy && t.paidBy !== 'company').length === 0 && (
                      <tr><td colSpan={5} className="p-10 text-center text-slate-400 text-sm font-bold">目前沒有任何股東往來紀錄</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            );
          })()}

          {/* TAB: 本月收租 (AR) */}
          {activeTab === 'receivable' && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden animate-in fade-in">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase font-black tracking-widest border-b border-slate-200">
                  <tr><th className="p-4 pl-5">房間 (物業)</th><th className="p-4">本月應收 ($)</th><th className="p-4">繳費狀態</th><th className="p-4 text-right pr-5">操作</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {occupiedRooms.map(room => {
                    const prop = properties.find(p => p.id === room.propertyId);
                    const payStatus = getRealPaymentStatus(room);
                    if (searchTerm && !room.name.toLowerCase().includes(searchTerm.toLowerCase()) && !prop?.name.toLowerCase().includes(searchTerm.toLowerCase())) return null;

                    return (
                      <tr key={room.id} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="p-4 pl-5">
                          <p className="font-black text-sm text-slate-800">{room.name}</p>
                          <p className="text-[10px] font-bold text-slate-500 flex items-center mt-0.5"><Home size={10} className="mr-1"/> {prop?.name || '未知物業'}</p>
                        </td>
                        <td className="p-4"><p className="font-mono font-black text-slate-800">${(room.baseRent || 0).toLocaleString()}</p></td>
                        <td className="p-4">
                          <span className={`inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-md bg-${payStatus.color}-50 text-${payStatus.color}-700 border border-${payStatus.color}-200`}>
                            {payStatus.status === 'paid' ? <CheckCircle size={14}/> : payStatus.status === 'pending' ? <Clock size={14}/> : payStatus.status === 'overdue' ? <AlertCircle size={14}/> : <Home size={14}/>}
                            {payStatus.label}
                          </span>
                        </td>
                        <td className="p-4 text-right pr-5">
                          {payStatus.status === 'paid' ? (
                            <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">已完款</span>
                          ) : (
                            <button className="text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors">發送催繳</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {occupiedRooms.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-400 text-sm font-bold">目前沒有已租出的房間</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB: 業主付租 (AP) */}
          {activeTab === 'payable' && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden animate-in fade-in">
              <div className="p-4 border-b border-red-100 bg-red-50/50 flex justify-between items-center">
                 <p className="text-xs font-black text-red-600 flex items-center"><AlertCircle size={14} className="mr-1.5"/> 點擊「標記已轉帳」，系統將自動依據付款頻率計算金額並記錄至總表。</p>
              </div>
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase font-black tracking-widest border-b border-slate-200">
                  <tr><th className="p-4 pl-5">物業與業主</th><th className="p-4">每次打款金額 (計算)</th><th className="p-4">歷史打款次數</th><th className="p-4 text-right pr-5">操作</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeProperties.map(prop => {
                    if (searchTerm && !prop.name.toLowerCase().includes(searchTerm.toLowerCase()) && !prop.landlordName?.toLowerCase().includes(searchTerm.toLowerCase())) return null;
                    const freq = prop.landlordPaymentFreq || 1;
                    const amountToPay = (prop.monthlyRent || 0) * freq;
                    const paidCount = prop.landlordPayments?.length || 0;

                    return (
                      <tr key={prop.id} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="p-4 pl-5">
                          <p className="font-black text-sm text-slate-800">{prop.name}</p>
                          <p className="text-[10px] font-bold text-slate-500 flex items-center mt-0.5"><User size={10} className="mr-1"/> {prop.landlordName || '未填寫業主'}</p>
                        </td>
                        <td className="p-4">
                          <p className="font-mono font-black text-red-600">${amountToPay.toLocaleString()}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">每 {freq} 個月付</p>
                        </td>
                        <td className="p-4">
                          <span className="inline-flex items-center gap-1 text-xs font-black px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
                            <CalendarDays size={14}/> 累計 {paidCount} 次
                          </span>
                        </td>
                        <td className="p-4 text-right pr-5">
                          <button onClick={() => handleRecordLandlordPayment(prop)} className="text-xs font-bold text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors flex items-center justify-end ml-auto gap-1">
                            <CheckCircle size={14}/> 標記已轉帳
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {activeProperties.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-400 text-sm font-bold">目前沒有生效中的物業</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB: 全部帳目管理 */}
          {activeTab === 'all' && (
            filteredTransactions.length === 0 ? (
              <div className="py-20 text-center text-slate-400 bg-white rounded-2xl border border-slate-200 shadow-sm animate-in fade-in">
                <CheckCircle className="mx-auto mb-4 opacity-50 text-emerald-500" size={48} />
                <p className="font-bold">目前沒有符合條件的自由財務紀錄</p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden animate-in fade-in">
                <table className="w-full text-left border-collapse min-w-[850px]">
                  <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase font-black tracking-widest border-b border-slate-200">
                    <tr>
                      <th className="p-4 w-12 text-center">狀態</th>
                      <th className="p-4">項目名稱與支付渠道</th>
                      <th className="p-4">付款方/墊付</th>
                      <th className="p-4">關聯對象</th>
                      <th className="p-4 w-32">日期/期限</th>
                      <th className="p-4 w-40 text-right">刷卡總額 (本金/手續費)</th>
                      <th className="p-4 w-32 text-center pr-5">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredTransactions.map(t => {
                      const isOverdue = t.status === 'pending' && t.dueDate < today;
                      const prop = properties.find(p => p.id === t.propertyId);
                      const tenant = tenants.find(tn => tn.id === t.tenantId);
                      const isCompany = !t.paidBy || t.paidBy === 'company';
                      const isVoided = t.status === 'voided'; 
                      const isFromProperty = t.id.startsWith('prop-exp-');
                      const isPayDollar = t.paymentMethod === 'PayDollar' || (t as any).gateway === 'PayDollar';

                      const isIncomeType = t.type === 'income' || (t.type as string) === 'AR';
                      const isExpenseType = t.type === 'expense' || (t.type as string) === 'AP';
                      const isCapitalIn = t.type === 'capital_in';
                      const isCapitalOut = t.type === 'capital_out';
                      
                      let badgeText = '租金收款';
                      let badgeColorClass = 'bg-emerald-50 text-emerald-600 border-emerald-200';
                      
                      if (isVoided) {
                        badgeText = '已作廢';
                        badgeColorClass = 'bg-slate-100 text-slate-400 border-slate-200';
                      } else if (t.status === 'Refunded') {
                        badgeText = '已退款';
                        badgeColorClass = 'bg-red-50 text-red-600 border-red-200';
                      } else if (isIncomeType) {
                        if (t.status === 'completed') {
                          badgeText = '租金收款';
                          badgeColorClass = 'bg-emerald-50 text-emerald-600 border-emerald-200';
                        } else {
                          badgeText = '應收 (AR)';
                          badgeColorClass = 'bg-blue-50 text-blue-600 border-blue-200';
                        }
                      } else if (isExpenseType) {
                        badgeText = t.status === 'completed' ? '已付支出' : '應付 (AP)';
                        badgeColorClass = 'bg-red-50 text-red-600 border-red-200';
                      } else if (isCapitalIn) {
                        badgeText = '股東注資';
                        badgeColorClass = 'bg-purple-50 text-purple-600 border-purple-200';
                      } else if (isCapitalOut) {
                        badgeText = '分紅提款';
                        badgeColorClass = 'bg-orange-50 text-orange-600 border-orange-200';
                      }

                      const totalCents = toCents(t.amount);
                      const subtotalCents = toCents(t.originalAmount || t.subtotal || t.amount);
                      const surchargeCents = totalCents > subtotalCents ? totalCents - subtotalCents : toCents(t.surcharge || 0);

                      return (
                        <tr key={t.id} className={`hover:bg-slate-50 transition-colors group ${isVoided ? 'opacity-60 bg-slate-50/50' : ''}`}>
                          <td className="p-4 text-center pl-5">
                            {isVoided ? (
                              <Ban size={24} className="text-slate-300 mx-auto" />
                            ) : isFromProperty ? (
                              <CheckCircle size={24} className="text-emerald-500 drop-shadow-sm mx-auto" />
                            ) : (
                              <button onClick={() => handleToggleStatus(t)} className="transition-transform active:scale-90" title={t.status === 'completed' ? '標示為未結清' : '標示為已結清'}>
                                {t.status === 'completed' ? <CheckCircle size={24} className="text-emerald-500 drop-shadow-sm" /> : <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${isOverdue ? 'border-red-400 bg-red-50' : 'border-slate-300 hover:border-blue-400'}`}>{isOverdue && <AlertCircle size={14} className="text-red-500"/>}</div>}
                              </button>
                            )}
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-1.5 flex-wrap">
                               <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${badgeColorClass}`}>
                                 {badgeText}
                               </span>
                               <span className={`font-bold text-sm ${isVoided ? 'text-slate-400 line-through' : t.status === 'completed' ? 'text-slate-400' : 'text-slate-800'}`}>{t.title}</span>
                               {t.isReconciled && <Lock size={12} className="text-emerald-600" title="已對帳鎖定" />}
                               
                               {t.paymentMethodDetail && (
                                 <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-md">
                                   {t.paymentMethodDetail}
                                 </span>
                               )}
                            </div>
                            
                            {t.subtitle && <p className="text-xs text-blue-600 font-semibold mt-1">{t.subtitle}</p>}
                            {t.description && <p className="text-[11px] text-slate-500 font-medium mt-0.5">{t.description}</p>}
                            {t.remarks && !t.description && <p className="text-xs text-slate-400 mt-1 truncate max-w-[200px]">{t.remarks}</p>}
                            
                            {t.receiptUrl && (
                              <a href={t.receiptUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded border border-blue-200 transition-colors w-max">
                                 <FileText size={10}/> 查看入數紙憑證
                              </a>
                            )}
                          </td>
                          <td className="p-4">
                            <span className={`text-[10px] font-bold px-2 py-1 rounded border ${isCompany ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-orange-50 text-orange-600 border-orange-200'}`}>
                              {staffList.find(s => s.id === t.paidBy)?.name || (t.paidBy === 'company' ? '公司帳戶' : t.paidBy)}
                            </span>
                          </td>
                          <td className="p-4 text-xs text-slate-500 space-y-1">
                            {prop && <div className="flex items-center gap-1 truncate max-w-[180px]"><Home size={12}/> <span className="font-bold text-slate-700">{prop.name}</span></div>}
                            {tenant && <div className="flex items-center gap-1 truncate max-w-[180px]"><User size={12}/> <span>{tenant.name}</span></div>}
                            {!prop && !tenant && <span className="text-slate-300 italic">無關聯</span>}
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-1.5 text-xs">
                              <Clock size={12} className={isOverdue && !isVoided ? 'text-red-500' : 'text-slate-400'}/>
                              <span className={`font-mono font-bold ${isOverdue && !isVoided ? 'text-red-500' : 'text-slate-600'}`}>{t.dueDate}</span>
                            </div>
                            {t.status === 'completed' && t.completedDate && <div className="text-[10px] text-emerald-500 mt-1 flex items-center gap-1"><CheckCircle size={10}/> 結清於 {t.completedDate}</div>}
                          </td>
                          <td className="p-4 text-right">
                            <span className={`font-mono font-bold text-base ${isVoided || t.status === 'completed' ? 'text-slate-400' : (isIncomeType || isCapitalIn ? 'text-blue-600' : 'text-red-600')}`}>
                              {isExpenseType || isCapitalOut ? '-' : '+'}${fromCents(totalCents).toLocaleString()}
                            </span>
                            
                            {surchargeCents > 0 && (
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                本金 ${fromCents(subtotalCents).toLocaleString()} | 費 ${fromCents(surchargeCents)}
                              </div>
                            )}
                          </td>
                          <td className="p-4 text-center pr-5">
                             {!isFromProperty && (
                               <div className="flex items-center justify-center gap-1.5">
                                  {isPayDollar && (
                                    <button onClick={() => setSelectedPayDollarTx(t)} className="p-1.5 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition" title="PayDollar 金流查詢與線上退款"><CreditCard size={16}/></button>
                                  )}
                                  <button onClick={() => openModal(t)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="編輯紀錄"><Edit size={16}/></button>
                                  {!isVoided && <button onClick={() => handleVoid(t)} className="p-1.5 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded" title="作廢紀錄"><Ban size={16}/></button>}
                                  <button onClick={() => handleDelete(t)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded" title="永久刪除"><Trash2 size={16}/></button>
                               </div>
                             )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* ★ 手動核銷彈窗 (Manual Match Modal) */}
      {/* ==================================================================== */}
      {manualMatchBankId && (() => {
        const bankTx = bankStatement.find(b => b.id === manualMatchBankId);
        if (!bankTx) return null;
        const availableSysTxs = unreconciledSysTxs.filter(t => !bankStatement.some(b => b.matchedTxId === t.id));

        return (
          <div className="fixed inset-0 bg-black/60 z-[120] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-200">
               <div className="p-4 border-b bg-blue-50 flex justify-between items-center">
                 <h3 className="font-bold text-blue-900 flex items-center gap-2"><LinkIcon size={18}/> 手動配對系統單據</h3>
                 <button onClick={() => setManualMatchBankId(null)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
               </div>
               <div className="p-4 bg-slate-50 border-b">
                 <p className="text-xs text-slate-500 mb-1">正在配對的銀行交易：</p>
                 <div className="flex justify-between items-center font-bold text-sm bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                   <span className="text-slate-800"><span className="font-mono text-slate-500 mr-2">{bankTx.date}</span> {bankTx.desc}</span>
                   <span className={`font-mono text-lg ${bankTx.amount > 0 ? 'text-emerald-600' : 'text-red-600'}`}>{bankTx.amount > 0 ? '+' : ''}{bankTx.amount.toLocaleString()}</span>
                 </div>
               </div>
               <div className="flex-1 overflow-y-auto p-4 bg-white">
                  {availableSysTxs.length === 0 ? (
                    <div className="text-center text-slate-400 py-10 flex flex-col items-center">
                      <AlertCircle size={32} className="mb-2 opacity-50"/>
                      <p className="text-sm font-bold">目前沒有可供配對的系統單據</p>
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr><th className="p-3">日期</th><th className="p-3">系統單據</th><th className="p-3 text-right">金額</th><th className="p-3 text-center">操作</th></tr>
                      </thead>
                      <tbody>
                        {availableSysTxs.map(sysTx => {
                          const isIncome = sysTx.type === 'income' || sysTx.type === 'AR' || sysTx.type === 'capital_in';
                          const isSameSign = (bankTx.amount > 0 && isIncome) || (bankTx.amount < 0 && !isIncome);
                          return (
                            <tr key={sysTx.id} className="border-b border-slate-100 hover:bg-blue-50 transition-colors">
                              <td className="p-3 font-mono text-slate-500">{sysTx.completedDate || sysTx.dueDate}</td>
                              <td className="p-3 font-bold text-slate-700">{sysTx.title}</td>
                              <td className={`p-3 text-right font-mono font-bold text-sm ${isIncome ? 'text-emerald-600' : 'text-red-600'}`}>
                                {isIncome ? '+' : '-'}{sysTx.amount.toLocaleString()}
                                {!isSameSign && <span className="block text-[9px] text-red-400 font-normal mt-0.5">⚠️ 收支方向不符</span>}
                              </td>
                              <td className="p-3 text-center">
                                <button onClick={() => handleManualMatch(bankTx.id, sysTx.id)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 font-bold shadow-sm transition active:scale-95">選此核銷</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
               </div>
            </div>
          </div>
        );
      })()}

      {/* PayDollar 退款與查單 Modal */}
      {selectedPayDollarTx && (
        <div className="fixed inset-0 bg-black/60 z-[90] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center p-4 border-b bg-slate-50">
              <div>
                <h3 className="font-bold text-base text-slate-800 flex items-center gap-2"><CreditCard className="text-blue-600" size={18}/> PayDollar 金流管控與退款</h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{selectedPayDollarTx.orderRef}</p>
              </div>
              <button onClick={() => { setSelectedPayDollarTx(null); setGatewayError(''); setGatewaySuccess(''); }} className="text-slate-400 hover:text-slate-600 p-1"><X size={20}/></button>
            </div>

            <div className="p-5 space-y-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-sm space-y-1.5">
                <div className="flex justify-between text-slate-600"><span>付款渠道</span><span className="font-bold text-blue-600">{selectedPayDollarTx.paymentMethodDetail || '線上刷卡'}</span></div>
                <div className="flex justify-between text-slate-600"><span>網關收據號 (PayRef)</span><span className="font-mono text-slate-800">{selectedPayDollarTx.payRef || 'N/A'}</span></div>
                <hr className="border-slate-200 my-1"/>
                <div className="flex justify-between text-xs text-slate-500"><span>應收租金本金 (Subtotal)</span><span className="font-mono">${fromCents(toCents(selectedPayDollarTx.originalAmount || selectedPayDollarTx.subtotal || selectedPayDollarTx.amount))}</span></div>
                <div className="flex justify-between text-xs text-slate-500"><span>刷卡手續費 (3%)</span><span className="font-mono">${fromCents(toCents(selectedPayDollarTx.amount) - toCents(selectedPayDollarTx.originalAmount || selectedPayDollarTx.subtotal || selectedPayDollarTx.amount))}</span></div>
                <div className="flex justify-between font-bold text-slate-900 pt-1"><span>實際刷卡總額</span><span className="font-mono text-emerald-600">${fromCents(toCents(selectedPayDollarTx.amount))}</span></div>
              </div>

              <div className="space-y-2">
                <button type="button" onClick={handleQueryGatewayStatus} disabled={gatewayLoading} className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition disabled:opacity-50">
                  <RefreshCw size={14} className={gatewayLoading ? 'animate-spin' : ''} /> 向 PayDollar 網關查詢真實扣款狀態
                </button>
                {gatewayQueryStatus && (
                  <div className="p-3 bg-blue-50/70 border border-blue-100 rounded-xl text-xs text-slate-700 space-y-1">
                    <div className="flex justify-between font-bold text-blue-900"><span>網關狀態: {gatewayQueryStatus.status}</span><span>貨幣: {gatewayQueryStatus.currency}</span></div>
                    <div className="text-slate-500">銀行過數金額: <strong className="font-mono text-slate-800">${gatewayQueryStatus.amount}</strong></div>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 space-y-2">
                <label className="block text-xs font-bold text-slate-700">發起線上沖銷與退款 (Refund)</label>
                <div className="flex gap-2">
                  <input type="number" step="0.01" placeholder={`最多 $${fromCents(toCents(selectedPayDollarTx.amount))}`} value={refundInput} onChange={(e) => setRefundInput(e.target.value)} disabled={gatewayLoading || !selectedPayDollarTx.payRef || selectedPayDollarTx.payRef === 'N/A'} className="flex-1 px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-red-500 font-mono disabled:bg-slate-100 disabled:text-slate-400" />
                  <button type="button" onClick={handleExecuteRefund} disabled={gatewayLoading || !refundInput || !selectedPayDollarTx.payRef || selectedPayDollarTx.payRef === 'N/A'} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs flex items-center gap-1 transition disabled:opacity-40 disabled:cursor-not-allowed">
                    <Banknote size={14} /> 執行退款
                  </button>
                </div>
                {(!selectedPayDollarTx.payRef || selectedPayDollarTx.payRef === 'N/A') ? (
                  <p className="text-[10px] text-amber-600 font-semibold">⚠️ 此單據尚未取得 PayDollar 官方收據號 (PayRef)，無法向銀行發起線上退款。</p>
                ) : (
                  <p className="text-[10px] text-slate-400">* 系統將透過官方 API 通訊發送銀行退款請求，成功後會將單據狀態自動標註為「已退款 (Refunded)」。</p>
                )}
              </div>

              {gatewayError && <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600 font-bold flex items-center gap-1.5"><AlertCircle size={16} className="shrink-0" /><span>{gatewayError}</span></div>}
              {gatewaySuccess && <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-700 font-bold flex items-center gap-1.5"><CheckCircle2 size={16} className="shrink-0" /><span>{gatewaySuccess}</span></div>}
            </div>
          </div>
        </div>
      )}

      {/* 自由新增表單 Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
            <div className="flex justify-between items-center p-4 border-b bg-slate-50 flex-none">
              <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><DollarSign className="text-blue-600" size={20}/>{editingId ? '編輯財務紀錄' : '建立新帳單/紀錄'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1"><X size={20}/></button>
            </div>
            
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                 <label className="block text-xs font-bold text-slate-500 mb-2">紀錄類型 *</label>
                 <div className="flex bg-slate-100 p-1 rounded-lg gap-1 overflow-x-auto hide-scrollbar">
                   <button type="button" onClick={() => setFormData({...formData, type: 'income'})} className={`flex-1 min-w-[80px] py-2 text-xs font-bold rounded flex flex-col items-center justify-center transition-colors ${formData.type === 'income' || (formData.type as string) === 'AR' ? 'bg-white text-blue-600 shadow-sm border border-blue-100' : 'text-slate-500 hover:bg-slate-200'}`}><ArrowDownRight size={16} className="mb-0.5"/> 應收 (收入)</button>
                   <button type="button" onClick={() => setFormData({...formData, type: 'expense'})} className={`flex-1 min-w-[80px] py-2 text-xs font-bold rounded flex flex-col items-center justify-center transition-colors ${formData.type === 'expense' ? 'bg-white text-red-600 shadow-sm border border-red-100' : 'text-slate-500 hover:bg-slate-200'}`}><ArrowUpRight size={16} className="mb-0.5"/> 應付 (支出)</button>
                   <button type="button" onClick={() => setFormData({...formData, type: 'capital_in'})} className={`flex-1 min-w-[80px] py-2 text-xs font-bold rounded flex flex-col items-center justify-center transition-colors ${formData.type === 'capital_in' ? 'bg-white text-purple-600 shadow-sm border border-purple-100' : 'text-slate-500 hover:bg-slate-200'}`}><ArrowDownToLine size={16} className="mb-0.5"/> 股東注資</button>
                   <button type="button" onClick={() => setFormData({...formData, type: 'capital_out'})} className={`flex-1 min-w-[80px] py-2 text-xs font-bold rounded flex flex-col items-center justify-center transition-colors ${formData.type === 'capital_out' ? 'bg-white text-orange-600 shadow-sm border border-orange-100' : 'text-slate-500 hover:bg-slate-200'}`}><ArrowUpFromLine size={16} className="mb-0.5"/> 分紅提款</button>
                 </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                 <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">支付/款項歸屬方 *</label>
                    <select value={formData.paidBy || 'company'} onChange={e => setFormData({...formData, paidBy: e.target.value})} className={`w-full p-2 border rounded-lg text-sm outline-none font-bold ${formData.paidBy && formData.paidBy !== 'company' ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-white text-slate-700 border-slate-300'}`}>
                      {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                 </div>
                 <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">當前狀態 *</label>
                    <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value as TransactionStatus})} className={`w-full p-2 border rounded-lg text-sm outline-none font-bold ${formData.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                      <option value="pending">待處理 (未結清)</option>
                      <option value="completed">已完成 (已結清 / 已墊付)</option>
                    </select>
                 </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">項目名稱 *</label>
                <input required value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} placeholder="例如：2026年3月份租金、Charles注資..." className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:border-blue-500 font-bold" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">金額 ($) *</label>
                  <input type="number" required value={formData.amount || ''} onChange={e => setFormData({...formData, amount: Number(e.target.value)})} placeholder="0" className={`w-full p-2.5 border rounded-lg text-lg font-mono font-bold outline-none focus:ring-2 ${['income', 'AR', 'capital_in'].includes(formData.type as string) ? 'text-blue-600 border-blue-200 focus:ring-blue-500' : 'text-red-600 border-red-200 focus:ring-red-500'}`} />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">應繳 / 期限日期 *</label>
                  <input type="date" required value={formData.dueDate} onChange={e => setFormData({...formData, dueDate: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:border-blue-500 font-mono" />
                </div>
              </div>

              {['income', 'AR', 'expense'].includes(formData.type as string) && (
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">關聯盤源 (選填)</label>
                    <select value={formData.propertyId} onChange={e => setFormData({...formData, propertyId: e.target.value, roomId: ''})} className="w-full p-2 border border-slate-300 rounded-lg text-xs bg-white outline-none">
                      <option value="">-- 無 --</option>
                      {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">關聯租客 (選填)</label>
                    <select value={formData.tenantId} onChange={e => setFormData({...formData, tenantId: e.target.value})} className="w-full p-2 border border-slate-300 rounded-lg text-xs bg-white outline-none">
                      <option value="">-- 無 --</option>
                      {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">備註說明 (選填)</label>
                <textarea value={formData.remarks} onChange={e => setFormData({...formData, remarks: e.target.value})} placeholder="銀行轉帳號碼、匯款人姓名等..." className="w-full p-2.5 border border-slate-300 rounded-lg text-sm h-16 resize-none outline-none focus:border-blue-500" />
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition">取消</button>
                <button type="submit" disabled={isSaving} className="flex-[2] py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-md transition disabled:opacity-50 flex justify-center items-center">
                  {isSaving ? <Loader2 size={18} className="animate-spin" /> : '儲存紀錄'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 批次刪除 Modal */}
      {isCleanModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
            <div className="flex justify-between items-center p-4 border-b bg-red-50 flex-none">
              <div>
                <h3 className="font-bold text-lg text-red-700 flex items-center gap-2">
                  <Trash2 size={20} /> 批次刪除資料
                </h3>
                <p className="text-xs text-red-500 mt-1">從目前的列表中選擇要刪除的資料 (共 {batchDeleteData.length} 筆)</p>
              </div>
              <button onClick={() => setIsCleanModalOpen(false)} className="text-red-400 hover:text-red-600 p-1"><X size={20}/></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-0 bg-slate-50">
              {batchDeleteData.length === 0 ? (
                <div className="p-10 text-center text-slate-400 flex flex-col items-center">
                  <FileText size={40} className="mb-2 text-slate-300" />
                  <p className="font-bold">目前列表中沒有可刪除的紀錄。</p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse bg-white">
                  <thead className="bg-slate-100 text-slate-500 text-[10px] uppercase font-black sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="p-3 pl-4 w-12 text-center">
                        <input 
                          type="checkbox" 
                          checked={selectedTestIds.size === batchDeleteData.length && batchDeleteData.length > 0}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedTestIds(new Set(batchDeleteData.map(t => t.id)));
                            else setSelectedTestIds(new Set());
                          }}
                          className="accent-red-500 cursor-pointer w-4 h-4"
                        />
                      </th>
                      <th className="p-3">項目名稱 / 備註</th>
                      <th className="p-3 text-right">金額</th>
                      <th className="p-3 w-28">類型</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {batchDeleteData.map(t => (
                      <tr key={t.id} className="hover:bg-red-50/50 transition-colors cursor-pointer" onClick={() => toggleTestSelection(t.id)}>
                        <td className="p-3 pl-4 text-center">
                          <input 
                            type="checkbox" 
                            checked={selectedTestIds.has(t.id)} 
                            onChange={() => toggleTestSelection(t.id)} 
                            onClick={e => e.stopPropagation()}
                            className="accent-red-500 cursor-pointer w-4 h-4"
                          />
                        </td>
                        <td className="p-3">
                          <p className="text-sm font-bold text-slate-800 line-clamp-1">{t.title}</p>
                          {t.remarks && <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{t.remarks}</p>}
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-slate-700">
                          ${t.amount.toLocaleString()}
                        </td>
                        <td className="p-3">
                          <span className={`text-[10px] px-2 py-1 rounded font-bold border ${t.type === 'income' || t.type === 'AR' || t.type === 'capital_in' ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                            {t.type}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-between items-center p-4 border-t bg-white flex-none">
              <span className="text-xs font-bold text-slate-500">已選擇 <span className="text-red-600">{selectedTestIds.size}</span> 筆</span>
              <div className="flex gap-2">
                <button onClick={() => setIsCleanModalOpen(false)} className="px-4 py-2 bg-slate-100 text-slate-600 font-bold rounded-lg hover:bg-slate-200 transition text-sm">取消</button>
                <button 
                  onClick={handleConfirmClean} 
                  disabled={selectedTestIds.size === 0 || loading} 
                  className="px-4 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 shadow-md transition disabled:opacity-50 flex items-center text-sm"
                >
                  {loading ? <Loader2 size={16} className="animate-spin mr-1" /> : <Trash2 size={16} className="mr-1" />} 
                  確認永久刪除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default function FinancePage() {
  return (
    <Suspense fallback={<div className="h-full flex justify-center items-center bg-slate-50"><Loader2 className="animate-spin text-blue-600" size={40} /></div>}>
      <FinanceContent />
    </Suspense>
  );
}
