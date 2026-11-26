import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { amount, email, name, phone } = await req.json();

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
        callback: process.env.NEXT_PUBLIC_SITE_URL + '/paiements/retour',
        reference: 'studyhelper_' + Date.now(),
      }),
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Erreur paiement' }, { status: 500 });
  }
      }
