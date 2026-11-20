import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminRouter from "./admin";
import studioRouter from "./studio";
import generationRouter from "./generation";
import kaggleWorkerRouter from "./kaggleWorker";
import { requireUser } from "../middlewares/requireUser";
import { startStudioJobWorker } from "../lib/studioJobs";

const router: IRouter = Router();

void startStudioJobWorker();

router.use(healthRouter);
router.use("/kaggle-worker", kaggleWorkerRouter);
router.use(requireUser, adminRouter);
router.use(requireUser, studioRouter);
router.use(requireUser, generationRouter);

export default router;
