// lib/finance.js

export function safeDivide(a, b) {
  if (!b || b === 0) return 0;
  return a / b;
}

export function calculateStaffCommissions(rawTransactions, userCommissionsRule = {}, serviceMapContext = {}, globalLabels = {}) {
  let scalpRev = 0;
  let prodRev = 0;
  let scalpClients = new Set();
  
  let uniqueClients = new Set();
  let uniqueWR = new Set();
  let uniqueScalp = new Set();
  let uniqueProduct = new Set();

  const pass1Txs = [];

  // ==============================================================
  // 🟢 Pass 1: 分類帳單並智能辨識動態標籤
  // ==============================================================
  (rawTransactions || []).forEach(tx => {
    const amount = Number(tx.amount || 0);
    let code = '未綁定參數';
    
    if (tx.type === 'assistant_bonus') {
       code = 'ASSISTANT_BONUS'; 
    } else if (tx.service && serviceMapContext[tx.service]) {
       code = serviceMapContext[tx.service];
    }

    // 🧠 智能辨識：就算老闆未來建立名為 "P6" 的自訂標籤，只要名稱含有「頭皮產品」，自動觸發階梯演算
    const labelName = globalLabels[code] || '';
    if (code === 'SCALP_PROD' || (tx.service && tx.service.includes('頭皮產品')) || labelName.includes('頭皮產品')) {
        code = 'SCALP_PROD';
    }

    if (tx.type === 'deduct' || tx.type === 'walkin_cash' || tx.type === 'deduct_package') {
       const ticketId = `${tx.timestamp}_${tx.phoneNumber || tx.id}`; 
       uniqueClients.add(ticketId);
       
       // 自動歸類客量統計 (基於命名規範)
       if (code.startsWith('W') || code.startsWith('R')) uniqueWR.add(ticketId);
       else if (code === 'SCALP') {
           uniqueScalp.add(ticketId);
           scalpClients.add(ticketId); 
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
  // 🟢 動態階梯算法
  // ==============================================================
  const scalpClientCount = scalpClients.size;
  const combinedRevenue = scalpRev + prodRev;
  const baseScalpPct = 25; 
  const baseProdPct = scalpClientCount >= 2 ? 25 : 20; 
  const bonusPct = Math.floor(combinedRevenue / 10000) * 5; 
  const finalScalpPct = baseScalpPct + bonusPct;
  const finalProdPct = baseProdPct + bonusPct;

  let revSum = 0;
  let commSum = 0;
  const categoryBreakdown = {}; 
  const processedTransactions = [];

  // ==============================================================
  // 🟢 Pass 2: 套用佣金與空值防護
  // ==============================================================
  pass1Txs.forEach(tx => {
    const amount = Number(tx.amount || 0);
    const code = tx.computedCode;
    revSum += amount;

    let calculatedComm = 0;

    if (tx.type === 'assistant_bonus') {
        calculatedComm = Number(tx.bonusAmount || 0);
    } else if (tx.commissionAmount !== undefined && tx.commissionAmount !== null) {
        calculatedComm = Number(tx.commissionAmount);
    } else if (code === 'SCALP') {
        calculatedComm = amount * (finalScalpPct / 100);
    } else if (code === 'SCALP_PROD') {
        calculatedComm = amount * (finalProdPct / 100);
    } else {
        // 🧠 即使是全新自訂標籤，也能安全提取 (若未設定則預設 0)
        const rule = userCommissionsRule[code] || { deduct: 0, percent: 0 };
        const deduct = Number(rule.deduct || 0);
        const percent = Number(rule.percent || 0);
        if (amount > deduct) {
          calculatedComm = (amount - deduct) * (percent / 100);
        }
    }

    // 解決 JavaScript 浮點數精度問題
    calculatedComm = Math.round(calculatedComm * 100) / 100;
    commSum += calculatedComm;

    if (!categoryBreakdown[code]) categoryBreakdown[code] = 0;
    categoryBreakdown[code] += amount;

    processedTransactions.push({ ...tx, computedCommission: calculatedComm });
  });

  processedTransactions.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());

  return {
    processedTransactions,
    dynamicTierStats: { scalpClientCount, combinedRevenue, finalScalpPct, finalProdPct },
    categoryBreakdown,
    stats: {
      totalRevenue: Math.round(revSum), totalCommission: Math.round(commSum), clientCount: uniqueClients.size,
      wrClientCount: uniqueWR.size, scalpClientCount: uniqueScalp.size, productClientCount: uniqueProduct.size,
      averageSpend: uniqueClients.size > 0 ? Math.round(revSum / uniqueClients.size) : 0
    }
  };
}
