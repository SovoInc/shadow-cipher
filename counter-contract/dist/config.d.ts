export declare const currentDir: string;
export interface Config {
    readonly logDir: string;
}
export declare class LogicTestingConfig implements Config {
    logDir: string;
    constructor();
}
