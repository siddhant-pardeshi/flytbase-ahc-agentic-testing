/**
 * In-page performance probes: installed into the page under test, they sample
 * rendering health (FPS, long tasks), resource pressure (DOM nodes, JS heap),
 * and Time-to-Glass (when injected data becomes visible on screen).
 */

export interface InstallHandles {
  /** Call to pull the latest probe readings out of the page. */
  read: () => Promise<ProbeReading>;
}

export interface ProbeReading {
  fps: number;
  longTasks: number;
  longestTaskMs: number;
  domNodes: number;
  heapMB: number | null;
}

export async function installProbes(page: import('playwright').Page): Promise<InstallHandles> {
  await page.evaluate(`
    (() => {
      if (window.__sentiProbe) return;
      const w = window;
      w.__senti = { frames: 0, longTasks: 0, longestTaskMs: 0, t0: performance.now() };
      const loop = () => { w.__senti.frames++; requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            w.__senti.longTasks++;
            w.__senti.longestTaskMs = Math.max(w.__senti.longestTaskMs, e.duration);
          }
        }).observe({ entryTypes: ['longtask'] });
      } catch {}
      window.__sentiRead = () => ({
        fps: Math.round(w.__senti.frames / ((performance.now() - w.__senti.t0) / 1000)),
        longTasks: w.__senti.longTasks,
        longestTaskMs: Math.round(w.__senti.longestTaskMs),
        domNodes: document.getElementsByTagName('*').length,
        heapMB: (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null),
      });
      window.__sentiProbe = true;
    })()
  `);
  return {
    read: async () => (await page.evaluate('window.__sentiRead()')) as ProbeReading,
  };
}
