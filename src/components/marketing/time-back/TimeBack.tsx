"use client";

import { useEffect, useRef } from "react";
import "./timeBack.css";
import { TIME_BACK_HTML } from "./timeBackHtml";
import { initTimeBack } from "./initTimeBack";

// Founder video + time-back calculator. The markup is static; the effect wires up the inputs.
export default function TimeBack() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) initTimeBack(ref.current);
  }, []);

  return <div ref={ref} className="tb" dangerouslySetInnerHTML={{ __html: TIME_BACK_HTML }} />;
}
