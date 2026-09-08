// lib/finance.js

export function safeDivide(a, b) {
  if (!b || b === 0) return 0;
  return a / b;
}

export function calculateStaffCommissions(rawTransactions, userCommissionsRule = {}, serviceMapContext = {}, globalLabels = {}) {
  let scalpRev = 0;
  let prodRev = 0;
  
  let realScalpClientCount = 0; // 真實報表客數 (無論金額多大，1個項目只算1客)
  let scalpTokens = 0;          // 🌟 隱藏代幣機制：用於觸發加成進度 ($6000給2點，其餘給1點)
  
  let uniqueClients = new Set();
  let uniqueWR = new Set();
  let uniqueScalp = new Set();
  let uniqueProduct = new Set();

  const pass1Txs = [];

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

    // 🧠 智能辨識：就算老闆未來建立名為 "P6" 的自訂標籤，只要名稱含有「頭皮產品」，自動觸發階梯演算
    const labelName = globalLabels[code] || '';
    if (code === 'SCALP_PROD' || itemName.includes('頭皮產品') || labelName.includes('頭皮產品')) {
        code = 'SCALP_PROD';
    } else if (!code || code === '未綁定參數') {
        // 基礎防呆：透過名稱自動猜測
        if (itemName.includes('W') || itemName.includes('洗剪吹')) code = 'W1';
        else if (itemName.includes('R') || itemName.includes('染') || itemName.includes('燙')) code = 'R1';
        else if (itemName.includes('頭皮') || itemName.includes('Scalp')) code = 'SCALP';
        else if (itemName.includes('Product') || itemName.includes('產品')) code = 'P1';
    }

    // 🛡️ 排除核銷與助手獎金，不計入實體客量與總產值
    if (tx.type !== 'deduct_package' && tx.type !== 'assistant_bonus') {
        const isAddon = itemName.includes('追加');
        const isProduct = code && String(code).startsWith('P');

        // 🟢 客數計算邏輯：獨立項目 (tx.id) 算 1 客，完全排除「追加」與「純產品」
        if (!isAddon && !isProduct && code !== 'SCALP') {
            uniqueClients.add(tx.id);
            if (code && (code.startsWith('W') || code.startsWith('R'))) {
                uniqueWR.add(tx.id);
            }
        } else if (isProduct) {
            uniqueProduct.add(tx.id);
        }

        // 統計頭皮與產品數據
        if (code === 'SCALP') {
            scalpRev += amount;
            
            // 🌟 只計算「非追加」的主項目客量與代幣
            if (!isAddon) {
                realScalpClientCount += 1;
                uniqueScalp.add(tx.id);
                uniqueClients.add(tx.id); // 頭皮也併入個人總客數
                
                // 🌟 核心規則：買 $6000(或以上)大套票，直接給予 2 點代幣 (立即觸發加成)
                if (amount >= 6000) {
                    scalpTokens += 2;
                } else {
                    scalpTokens += 1;
                }
            }
        } 
        else if (code === 'SCALP_PROD') {
            prodRev += amount;
        }
    }

    pass1Txs.push({ ...tx, computedCode: code });
  });

  // ==============================================================
  // 🟢 動態階梯算法
  // ==============================================================
  const combinedRevenue = scalpRev + prodRev;
  const baseScalpPct = 25; 
  const baseProdPct = 20; 
  
  // 計算加成級別 (每滿 2 點代幣 = 升一階 = 多 5%)
  const bonusLevel = Math.floor(scalpTokens / 2);
  const boostPct = bonusLevel * 5; 
  
  const finalScalpPct = baseScalpPct + boostPct;
  const finalProdPct = baseProdPct + boostPct;

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
    
    let calculatedComm = 0;

    if (tx.type === 'assistant_bonus') {
        calculatedComm = Number(tx.bonusAmount || 0);
    } else if (tx.type === 'deduct_package') {
        calculatedComm = 0; // 核銷扣次無實收佣金 (賣套票時已算過)
    } else if (tx.commissionAmount !== undefined && tx.commissionAmount !== null) {
        calculatedComm = Number(tx.commissionAmount);
    } else if (code === 'SCALP') {
        calculatedComm = amount * (finalScalpPct / 100);
    } else if (code === 'SCALP_PROD') {
        calculatedComm = amount * (finalProdPct / 100);
    } else {
        const rule = userCommissionsRule[code] || { deduct: 0, percent: 0 };
        const deduct = Number(rule.deduct || 0);
        const percent = Number(rule.percent || 0);
        if (amount > deduct) {
          calculatedComm = (amount - deduct) * (percent / 100);
        }
    }

    // 解決 JavaScript 浮點數精度問題
    calculatedComm = Math.round(calculatedComm * 100) / 100;
    
    // 核銷次數與助手獎金不計入總產值 (避免重複計算業績)
    if (tx.type !== 'deduct_package' && tx.type !== 'assistant_bonus') {
        revSum += amount;
        if (!categoryBreakdown[code]) categoryBreakdown[code] = 0;
        categoryBreakdown[code] += amount;
    }

    commSum += calculatedComm;
    
    // 助手獎金獨立加入 BreakDown
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
      scalpClientCount: scalpTokens, // 傳給前端 UI：用來顯示還差幾位升級 (代幣數)
      realScalpClientCount,          // 傳給前端 UI：顯示真實的客量
      combinedRevenue, 
      finalScalpPct, 
      finalProdPct 
    },
    categoryBreakdown,
    stats: {
      totalRevenue: Math.round(revSum), 
      totalCommission: Math.round(commSum), 
      clientCount: uniqueClients.size,
      wrClientCount: uniqueWR.size, 
      scalpClientCount: realScalpClientCount, // 報表大數顯示真實客數
      productClientCount: uniqueProduct.size,
      averageSpend: uniqueClients.size > 0 ? Math.round(revSum / uniqueClients.size) : 0
    }
  };
}
