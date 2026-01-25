import path from 'node:path';
export const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');
export class LogicTestingConfig {
    logDir = path.resolve(currentDir, '..', 'logs', 'logic-testing', `${new Date().toISOString()}.log`);
    constructor() { }
}
//# sourceMappingURL=config.js.map