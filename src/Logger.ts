import { Context } from "@azure/functions";

export class Logger {
    constructor(private context: Context) { }

    Log(message: any) {
        this.context.log(message);
    }

    Debug(message: any) {
        if (process.env.DEBUG == "true") {
            this.context.log("DEBUG: " + message);
        }
    }

    Error(err: any) {
        this.context.log("ERROR: " + err.message);
        if (err.isAxiosError) {
            this.context.log("AXIOS ERROR: " + err.response.data.message);
        }
    }
}