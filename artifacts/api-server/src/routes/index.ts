import { Router, type IRouter } from "express";
import contactRouter from "./contact";

const router: IRouter = Router();

router.use(contactRouter);

export default router;
