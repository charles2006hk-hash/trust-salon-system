import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    // 1. 接收前端 POS 傳來的結帳資料
    const body = await request.json();
    const { phone, amount, service, newBalance } = body;

    // 2. 格式化電話號碼 (Meta API 要求不能有 '+' 號)
    // 假設前端傳來的是 +85298765432，轉換為 85298765432
    const cleanPhone = phone.replace('+', '');

    // 3. 組合要發送給客人的客製化訊息
    const messageText = `💇‍♀️ *Trust Hair Salon 扣款收據*\n\n感謝您的光臨！本次消費明細如下：\n▪️ 服務項目：${service}\n▪️ 本次扣除：*$${amount} T-Dollar*\n\n💰 您的帳戶目前剩餘：*$${newBalance} T-Dollar*\n\n期待為您再次服務！`;

    // 4. 準備發送給 Meta Cloud API
    const WA_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
    const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

    const url = `https://graph.facebook.com/v19.0/${PHONE_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to: cleanPhone,
      type: "text",
      text: { body: messageText }
    };

    // 5. 執行發送
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    // 錯誤處理
    if (!response.ok) {
      console.error("Meta API 錯誤:", data);
      return NextResponse.json({ success: false, error: data }, { status: 400 });
    }

    // 發送成功
    return NextResponse.json({ success: true, messageId: data.messages[0].id });

  } catch (error) {
    console.error("API 執行錯誤:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}