'use client';

import Script from 'next/script';
import { Databuddy } from '@databuddy/sdk/react';

const isProduction = process.env.NODE_ENV === 'production';

export function Analytics() {
  if (!isProduction) return null;

  return (
    <>
      <Script
        async
        src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-8704843786311642"
        crossOrigin="anonymous"
        strategy="afterInteractive"
      />
      <Script
        async
        src="https://www.googletagmanager.com/gtag/js?id=G-WWTQR26VH4"
        strategy="afterInteractive"
      />
      <Script id="ga4" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-WWTQR26VH4');`}
      </Script>
      <Databuddy
        clientId={'961c3ecd-da76-4b89-95cb-ee72a5fb72f4'}
        trackWebVitals
        trackErrors
        trackOutgoingLinks
      />
    </>
  );
}
