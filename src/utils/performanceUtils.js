/**
 * 性能监控工具
 * 从 MainWorkspace.js 中抽取
 */

export const performanceMonitor = {
  marks: {},
  slowOperations: [],
  
  start(label) {
    this.marks[label] = performance.now();
  },
  
  end(label) {
    if (this.marks[label]) {
      const duration = performance.now() - this.marks[label];
      if (duration > 100) {
        console.warn(`[PERFORMANCE] ${label} 耗时 ${duration.toFixed(2)}ms (超过100ms阈值)`);
      } else {
        console.log(`[PERFORMANCE] ${label} 耗时 ${duration.toFixed(2)}ms`);
      }
      delete this.marks[label];
      return duration;
    }
    return 0;
  },
  
  record(operation, duration) {
    this.slowOperations.push({
      operation,
      duration,
      timestamp: Date.now()
    });
    
    // 最多保留 10 个操作记录
    if (this.slowOperations.length > 10) {
      this.slowOperations.shift();
    }
    
    console.log(`[PERFORMANCE] 操作记录: ${operation} - ${duration.toFixed(2)}ms`);
  },
  
  getReport() {
    const avgDuration = this.slowOperations.length > 0
      ? this.slowOperations.reduce((sum, op) => sum + op.duration, 0) / this.slowOperations.length
      : 0;
    
    return {
      totalOperations: this.slowOperations.length,
      averageDuration: avgDuration,
      operations: this.slowOperations
    };
  },
  
  clear() {
    this.slowOperations = [];
  }
};

export const runPerformanceTest = (testName, fn, iterations = 10) => {
  const times = [];
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    times.push(end - start);
  }
  
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  
  console.log(`[PERFORMANCE TEST] ${testName}`);
  console.log(`  平均: ${avg.toFixed(2)}ms`);
  console.log(`  最小: ${min.toFixed(2)}ms`);
  console.log(`  最大: ${max.toFixed(2)}ms`);
  console.log(`  总计: ${times.reduce((a, b) => a + b, 0).toFixed(2)}ms`);
  
  return { avg, min, max, times };
};
