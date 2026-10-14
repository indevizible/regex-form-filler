export function matchWithTimeout(rules, labels) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./regex-worker.js', import.meta.url), { type: 'module' });
    const finish = (error, matches) => {
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(new Error(error)); else resolve(matches);
    };
    const timer = setTimeout(() => finish('regex ใช้เวลานานเกิน 1.5 วินาที ยกเลิกแล้วโดยยังไม่กรอกข้อมูล'), 1500);
    worker.onmessage = ({ data }) => finish(data.error, data.matches);
    worker.onerror = event => {
      event.preventDefault();
      finish('เปิด Worker ไม่สำเร็จ จึงยังไม่กรอกข้อมูล');
    };
    worker.postMessage({ rules, labels });
  });
}
