import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adminRouter from "./admin";
import studioRouter from "./studio";
import generationRouter from "./generation";
import kaggleWorkerRouter from "./kaggleWorker";
import { requireUser } from "../middlewares/requireUser";

const router: IRouter = Router();


router.use(healthRouter);
router.use("/kaggle-worker", kaggleWorkerRouter);
// Colab uses the same transactional job queue and lease protocol as Kaggle.
router.use("/colab-worker", kaggleWorkerRouter);
router.use(requireUser, adminRouter);
router.use(requireUser, studioRouter);
router.use(requireUser, generationRouter);

export default router;
