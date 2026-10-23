// lib/finance.js

export function safeDivide(a, b) {
  if (!b || b === 0) return 0;
  return a / b;
}

export function calculateStaffCommissions(rawTransactions, userCommissionsRule = {}, serviceMapContext = {}, globalLabels = {}) {
  let scalpRev = 0;
  let prodRev = 0;
  
  let realScalpClientCount = 0; 
  let scalpTokens = 0;          
  
  let uniqueClients = new Set();
  let uniqueWR = new Set();
  let uniqueScalp = new Set();
  let uniqueProduct = new Set();

  const pass1Txs = [];

  // ==============================================================
  // 🟢 階梯式觸發計算 (Bonus Tier System) - 預處理階段
  // ==============================================================
  // 1. 取得該員工設定的階梯觸發條件
  const bonusTierConfig = userCommissionsRule.bonusTier || null;
  const isBonusTierActive = !!bonusTierConfig && bonusTierConfig.enabled;
  
  // 2. 計算觸發目標的累積金額 (以月為單位，此處簡化為傳入的 rawTransactions 總和)
  let triggerAccumulatedAmount = 0;

  // ==============================================================
  // 🟢 Pass 1: 分類帳單並智能辨識動態標籤 (追加項目排除、代幣機制)
  // ==============================================================
  (rawTransactions || []).forEach(tx => {
    let code = '未綁定參數';
    const itemName = tx.service || tx.packageName || '';
    const amount = Number(tx.amount || tx.amountPaidHKD || 0); 
    
    if (tx.type === 'assistant_bonus') {
       code = 'ASSISTANT_BONUS'; 
    } else if (itemName && serviceMapContext[itemName]) {
       code = serviceMapContext[itemName];
    }

    const labelName = globalLabels[code] || '';
    if (code === 'SCALP_PROD' || itemName.includes('頭皮產品') || labelName.includes('頭皮產品')) {
        code = 'SCALP_PROD';
    } else if (!code || code === '未綁定參數') {
        if (itemName.includes('W') || itemName.includes('洗剪吹')) code = 'W1';
        else if (itemName.includes('R') || itemName.includes('染') || itemName.includes('燙')) code = 'R1';
        else if (itemName.includes('頭皮') || itemName.includes('Scalp')) code = 'SCALP';
        else if (itemName.includes('Product') || itemName.includes('產品')) code = 'P1';
    }

    if (tx.type !== 'deduct_package' && tx.type !== 'assistant_bonus') {
        const isAddon = itemName.includes('追加');
        const isProduct = code && String(code).startsWith('P');

        if (!isAddon && !isProduct && code !== 'SCALP') {
            uniqueClients.add(tx.id);
            if (code && (code.startsWith('W') || code.startsWith('R'))) {
                uniqueWR.add(tx.id);
            }
        } else if (isProduct) {
            uniqueProduct.add(tx.id);
        }

        if (code === 'SCALP') {
            scalpRev += amount;
            if (!isAddon) {
                realScalpClientCount += 1;
                uniqueScalp.add(tx.id);
                uniqueClients.add(tx.id); 
                if (amount >= 6000) scalpTokens += 2;
                else scalpTokens += 1;
            }
        } 
        else if (code === 'SCALP_PROD') {
            prodRev += amount;
        }

        // 🌟 統計階梯觸發金額
        if (isBonusTierActive && bonusTierConfig.triggerCodes && bonusTierConfig.triggerCodes.includes(code)) {
            triggerAccumulatedAmount += amount;
        }
    }

    pass1Txs.push({ ...tx, computedCode: code });
  });

  // 🌟 判定階梯是否達標
  const isBonusTierAchieved = isBonusTierActive && (triggerAccumulatedAmount >= (Number(bonusTierConfig.threshold) || 0));

  // ==============================================================
  // 🟢 頭皮動態階梯算法
  // ==============================================================
  const combinedRevenue = scalpRev + prodRev;
  const baseScalpPct = 25; 
  const baseProdPct = 20; 
  const bonusLevel = Math.floor(scalpTokens / 2);
  const boostPct = bonusLevel * 5; 
  const finalScalpPct = baseScalpPct + boostPct;
  const finalProdPct = baseProdPct + boostPct;

  let revSum = 0;
  let commSum = 0;
  const categoryBreakdown = {}; 
  const processedTransactions = [];

  // ==============================================================
  // 🟢 Pass 2: 套用佣金與空值防護 (支援階梯達標替換)
  // ==============================================================
  pass1Txs.forEach(tx => {
    const amount = Number(tx.amount || 0);
    const code = tx.computedCode;
    
    let calculatedComm = 0;

    if (tx.type === 'assistant_bonus') {
        calculatedComm = Number(tx.bonusAmount || 0);
    } else if (tx.type === 'deduct_package') {
        calculatedComm = 0; 
    } else if (tx.commissionAmount !== undefined && tx.commissionAmount !== null) {
        calculatedComm = Number(tx.commissionAmount);
    } else if (code === 'SCALP') {
        calculatedComm = amount * (finalScalpPct / 100);
    } else if (code === 'SCALP_PROD') {
        calculatedComm = amount * (finalProdPct / 100);
    } else {
        // 🌟 判斷是否使用基礎 Rule 或 達標 Bonus Rule
        const baseRule = userCommissionsRule[code] || { deduct: 0, percent: 0 };
        const bonusRule = bonusTierConfig && bonusTierConfig.bonusRules ? bonusTierConfig.bonusRules[code] : null;
        
        let targetRule = baseRule;
        let isAppliedBonus = false;

        // 如果該員工開啟了階梯、且有設定該項目的 Bonus Rule、並且當月達標了
        if (isBonusTierAchieved && bonusRule && (bonusRule.percent > 0 || bonusRule.deduct > 0)) {
            targetRule = bonusRule;
            isAppliedBonus = true;
        }

        const deduct = Number(targetRule.deduct || 0);
        const percent = Number(targetRule.percent || 0);
        
        if (amount > deduct) {
          calculatedComm = (amount - deduct) * (percent / 100);
        }

        // 將是否套用階梯獎勵的狀態標記在 tx 上，供前端 UI 顯示
        tx.isAppliedBonus = isAppliedBonus;
    }

    calculatedComm = Math.round(calculatedComm * 100) / 100;
    
    if (tx.type !== 'deduct_package' && tx.type !== 'assistant_bonus') {
        revSum += amount;
        if (!categoryBreakdown[code]) categoryBreakdown[code] = 0;
        categoryBreakdown[code] += amount;
    }

    commSum += calculatedComm;
    
    if (tx.type === 'assistant_bonus') {
        if (!categoryBreakdown['ASSISTANT_BONUS']) categoryBreakdown['ASSISTANT_BONUS'] = 0;
        categoryBreakdown['ASSISTANT_BONUS'] += calculatedComm;
    }

    processedTransactions.push({ ...tx, computedCommission: calculatedComm });
  });

  processedTransactions.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());

  return {
    processedTransactions,
    dynamicTierStats: { 
      scalpClientCount: scalpTokens, 
      realScalpClientCount,          
      combinedRevenue, 
      finalScalpPct, 
      finalProdPct,
      // 🌟 回傳階梯觸發狀態給前端
      triggerAccumulatedAmount,
      isBonusTierAchieved,
      bonusTierThreshold: isBonusTierActive ? bonusTierConfig.threshold : 0
    },
    categoryBreakdown,
    stats: {
      totalRevenue: Math.round(revSum), 
      totalCommission: Math.round(commSum), 
      clientCount: uniqueClients.size,
      wrClientCount: uniqueWR.size, 
      scalpClientCount: realScalpClientCount, 
      productClientCount: uniqueProduct.size,
      averageSpend: uniqueClients.size > 0 ? Math.round(revSum / uniqueClients.size) : 0
    }
  };
}
