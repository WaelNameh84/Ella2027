import { Router, type IRouter } from "express";
import healthRouter from "./health";
import studioRouter from "./studio";
import { requireUser } from "../middlewares/requireUser";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireUser, studioRouter);

export default router;
