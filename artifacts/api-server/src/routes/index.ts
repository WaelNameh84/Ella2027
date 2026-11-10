import { Router, type IRouter } from "express";
import healthRouter from "./health";
import studioRouter from "./studio";
import { requireUser } from "../middlewares/requireUser";
import { startStudioJobWorker } from "../lib/studioJobs";

const router: IRouter = Router();

void startStudioJobWorker();

router.use(healthRouter);
router.use(requireUser, studioRouter);

export default router;
