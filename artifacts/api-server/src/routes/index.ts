import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminRouter from "./admin";
import studioRouter from "./studio";
import generationRouter from "./generation";
import kaggleWorkerRouter from "./kaggleWorker";
import kaggleWan22WorkerRouter from "./kaggleWan22Worker";
import aiTeamRouter from "./aiTeam";
import { requireUser } from "../middlewares/requireUser";

const router: IRouter = Router();


router.use(healthRouter);
router.use("/kaggle-worker", kaggleWorkerRouter);
router.use("/kaggle-wan22-worker", kaggleWan22WorkerRouter);
// Colab uses the same transactional job queue and lease protocol as Kaggle.
router.use("/colab-worker", kaggleWorkerRouter);
router.use(requireUser, aiTeamRouter);
router.use(requireUser, adminRouter);
router.use(requireUser, studioRouter);
router.use(requireUser, generationRouter);

export default router;
