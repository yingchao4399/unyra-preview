/**
 * vite.config.ts 的 define 注入的常量：package.json 里的 version。
 *
 * 为什么走注入而不是 import package.json：把 package.json 打进渲染层会把依赖清单
 * 一起带进产物；而版本号只有 package.json 一处真值，注入既单一又零成本。
 * 界面上显示它的地方：设置 → 关于。
 */
declare const __APP_VERSION__: string

/**
 * vite.config.ts 的 define 注入的常量：构建期的公告地址覆盖值。
 *
 * 来源是环境变量 `VITE_NOTICE_URL`（没设就是空串）。空串表示「用
 * src/lib/noticeConfig.ts 里的默认地址」——默认地址只有那一处真值，
 * 这里注入的只是「想不想覆盖」。
 */
declare const __NOTICE_URL_ENV__: string
