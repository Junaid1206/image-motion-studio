import { httpRouter } from "convex/server";
import { auth } from "./auth";
import {
  workerIndex,
  workerHealth,
  workerClaim,
  workerProgress,
  workerComplete,
  workerFail,
  workerJobStatus,
} from "./worker";

const http = httpRouter();

// Existing auth routes (preserved untouched).
auth.addHttpRoutes(http);

// GPU worker API (Google Colab worker protocol).
http.route({ path: "/worker_api", method: "GET", handler: workerIndex });
http.route({ path: "/worker_api/health", method: "POST", handler: workerHealth });
http.route({ path: "/worker_api/claim", method: "POST", handler: workerClaim });
http.route({ path: "/worker_api/progress", method: "POST", handler: workerProgress });
http.route({ path: "/worker_api/complete", method: "POST", handler: workerComplete });
http.route({ path: "/worker_api/fail", method: "POST", handler: workerFail });
http.route({ path: "/worker_api/job-status", method: "POST", handler: workerJobStatus });

export default http;
