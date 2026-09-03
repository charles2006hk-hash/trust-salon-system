// lib/finance.js

/**
 * 安全除法，避免 Infinity 或 NaN
 */
export function safeDivide(a, b) {
  if (!b || b === 0) return 0;
  return a / b;
}

/**
 * 🎯 核心拆帳計算引擎 (Core Commission Engine)
 * 負責處理複雜的階梯式跳級算法，解決 JavaScript 浮點數精度誤差。
 * 供前台「設計師業績板」與後台「老闆薪資結算」共用，保證數據 100% 同步。
 * 
 * @param {Array} rawTransactions - 該設計師在指定期間內的所有原始交易紀錄
 * @param {Object} userCommissionsRule - 該設計師的基礎抽成設定 (deduct, percent)
 * @param {Object} serviceMapContext - 系統設定的服務對應代碼字典
 * @param {Object} globalLabels - 系統全域標籤設定
 * @returns {Object} 包含處理好的帳單陣列、階梯狀態、分類大數、總結數據
 */
export function calculateStaffCommissions(
  rawTransactions, 
  userCommissionsRule = {}, 
  serviceMapContext = {}, 
  globalLabels = {}
) {
  let scalpRev = 0;
  let prodRev = 0;
  let scalpClients = new Set();
  
  let uniqueClients = new Set();
  let uniqueWR = new Set();
  let uniqueScalp = new Set();
  let uniqueProduct = new Set();

  const pass1Txs = [];

  // ==============================================================
  // 🟢 Pass 1: 分類帳單並計算 SCALP 與 產品 的客量及總金額
  // ==============================================================
  rawTransactions.forEach(tx => {
    const amount = Number(tx.amount || 0);
    let code = '未綁定參數';
    
    if (tx.type === 'assistant_bonus') {
       code = 'ASSISTANT_BONUS'; 
    } else if (tx.service && serviceMapContext[tx.service]) {
       code = serviceMapContext[tx.service];
    }

    // ⚠️ 標籤防呆：若老闆自訂了「頭皮產品」標籤，或項目包含頭皮產品，強制歸類為 SCALP_PROD
    if (code === 'SCALP_PROD' || (tx.service && tx.service.includes('頭皮產品')) || globalLabels[code] === '頭皮產品') {
        code = 'SCALP_PROD';
    }

    // 計算獨立客量 (以 Timestamp + 手機號碼為 Unique ID)
    if (tx.type === 'deduct' || tx.type === 'walkin_cash' || tx.type === 'deduct_package') {
       const ticketId = `${tx.timestamp}_${tx.phoneNumber || tx.id}`; 
       uniqueClients.add(ticketId);
       
       if (code.startsWith('W') || code.startsWith('R')) uniqueWR.add(ticketId);
       else if (code === 'SCALP') {
           uniqueScalp.add(ticketId);
           scalpClients.add(ticketId); // 專門給頭皮套票算客量
           scalpRev += amount;
       } 
       else if (code === 'SCALP_PROD') {
           uniqueProduct.add(ticketId);
           prodRev += amount;
       }
       else if (code.startsWith('P')) uniqueProduct.add(ticketId);
    }

    pass1Txs.push({ ...tx, computedCode: code });
  });

  // ==============================================================
  // 🟢 階梯式動態拆帳演算法 (Tier-based Algorithm)
  // ==============================================================
  const scalpClientCount = scalpClients.size;
  const combinedRevenue = scalpRev + prodRev;
  
  // 規則 1：套票固定基礎 25%。產品基礎視套票客量決定 (>= 2 人給 25%，否則 20%)
  const baseScalpPct = 25; 
  const baseProdPct = scalpClientCount >= 2 ? 25 : 20; 
  
  // 規則 2：總業績每滿 $10000，兩者的最終拆帳比例額外 +5%
  const bonusPct = Math.floor(combinedRevenue / 10000) * 5; 
  
  const finalScalpPct = baseScalpPct + bonusPct;
  const finalProdPct = baseProdPct + bonusPct;

  const dynamicTierStats = {
     scalpClientCount,
     combinedRevenue,
     finalScalpPct,
     finalProdPct
  };

  // ==============================================================
  // 🟢 Pass 2: 套用最終 % 數計算每筆實得提成與總業績
  // ==============================================================
  let revSum = 0;
  let commSum = 0;
  let breakdown = {};
  const processedTransactions = [];

  pass1Txs.forEach(tx => {
    const amount = Number(tx.amount || 0);
    const code = tx.computedCode;
    revSum += amount;

    let calculatedComm = 0;

    if (tx.type === 'assistant_bonus') {
        calculatedComm = Number(tx.bonusAmount || 0);
    } else if (tx.commissionAmount !== undefined && tx.commissionAmount !== null) {
        // 若已經被後台手動鎖定提成的特例
        calculatedComm = Number(tx.commissionAmount);
    } else if (code === 'SCALP') {
        calculatedComm = amount * (finalScalpPct / 100);
    } else if (code === 'SCALP_PROD') {
        calculatedComm = amount * (finalProdPct / 100);
    } else {
        // 常規項目 (W1, R1, P1...) 讀取預設扣減與成數
        const rule = userCommissionsRule[code];
        if (rule) {
          const deduct = Number(rule.deduct || 0);
          const percent = Number(rule.percent || 0);
          if (amount > deduct) {
            calculatedComm = (amount - deduct) * (percent / 100);
          }
        }
    }

    // 🛡️ 解決 JavaScript 浮點數精度誤差 (如 0.1 + 0.2 = 0.30000000000000004)
    calculatedComm = Math.round(calculatedComm * 100) / 100;

    commSum += calculatedComm;
    if (!breakdown[code]) breakdown[code] = 0;
    breakdown[code] += amount;

    processedTransactions.push({ ...tx, computedCommission: calculatedComm });
  });

  // 按時間倒序排列
  processedTransactions.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());

  return {
    processedTransactions,
    dynamicTierStats,
    categoryBreakdown,
    stats: {
      totalRevenue: Math.round(revSum),
      totalCommission: Math.round(commSum),
      clientCount: uniqueClients.size,
      wrClientCount: uniqueWR.size,
      scalpClientCount: uniqueScalp.size,
      productClientCount: uniqueProduct.size,
      averageSpend: uniqueClients.size > 0 ? Math.round(revSum / uniqueClients.size) : 0
    }
  };
}
