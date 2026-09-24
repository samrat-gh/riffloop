"use client";

import dynamic from "next/dynamic";

// Audio and localStorage exist only in the browser, so the looper is never server-rendered.
const Looper = dynamic(() => import("@/components/Looper"), { ssr: false });

export default function Home() {
  return <Looper />;
}
