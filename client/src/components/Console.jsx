// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO
import { useRef, useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import styles from './Console.module.css';

export default function Console() {
  const consoleLogs = useAppStore((s) => s.consoleLogs);
  const clearLogs   = useAppStore((s) => s.clearLogs);
  const bottomRef   = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleLogs]);

  return (
    <section className={styles.console}>
      <header className={styles.header}>
        <span>Console</span>
        <button onClick={clearLogs} className={styles.clearBtn}>Clear</button>
      </header>
      <div className={styles.log}>
        {consoleLogs.map((line, i) => (
          <div key={i} className={styles.line}>{line}</div>
        ))}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
