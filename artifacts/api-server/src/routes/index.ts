import { Router, type IRouter } from "express";
import contactRouter from "./contact";
import emailRouter from "./email";

const router: IRouter = Router();

router.use(contactRouter);
router.use(emailRouter);

export default router;
