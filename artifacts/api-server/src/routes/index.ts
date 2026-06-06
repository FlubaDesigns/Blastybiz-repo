import { Router, type IRouter } from "express";
import healthRouter from "./health";
import adaptListingRouter from "./adapt-listing";
import resolveCategoriesRouter from "./resolve-categories";
import approveDraftRouter from "./approve-draft";

const router: IRouter = Router();

router.use(healthRouter);
router.use(adaptListingRouter);
router.use(resolveCategoriesRouter);
router.use(approveDraftRouter);

export default router;
