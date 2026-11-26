import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { amount, email, name, phone } = await req.json();

    const reference = 'studyhelper_' + Date.now();

    const res = await fetch('https://api.notchpay.co/payments', {
      method: 'POST',
      headers: {
        'Authorization': process.env.NOTCHPAY_PUBLIC_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amount,
        currency: 'XAF',
        customer: {
          name: name || 'Eleve Studyhelper',
          email: email || 'eleve@gmail.com',
          phone: phone || '+237690000000',
        },
        description: 'Abonnement Premium Studyhelper',
        callback: process.env.NEXT_PUBLIC_SITE_URL + '/payments/return?ref=' + reference,
        reference: reference,
      }),
    });

    const data = await res.json();

    // Notch Pay renvoie le lien dans authorization_url
    const paymentUrl = data?.authorization_url || data?.transaction?.authorization_url || data?.data?.authorization_url;

    if (!paymentUrl) {
      console.log('NotchPay error:', data);
      return NextResponse.json({ error: 'NotchPay na pas renvoye de lien', details: data }, { status: 500 });
    }

    return NextResponse.json({ paymentUrl, ref: reference });
  } catch (error) {
    return NextResponse.json({ error: 'Erreur paiement' }, { status: 500 });
  }
}
