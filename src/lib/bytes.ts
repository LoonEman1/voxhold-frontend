const GiB = 1024 ** 3
export function bytes(value: number) { if (value < 1024) return `${value} Б`; if (value < 1024 ** 2) return `${(value / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} КБ`; return value >= GiB ? `${(value / GiB).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ГБ` : `${(value / 1024 ** 2).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ` }
