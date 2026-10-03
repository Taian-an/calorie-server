const express = require('express');
const { requireAdminAuth } = require('../middleware/adminAuth');
const { adminLoginLimiter } = require('../middleware/rateLimiter');
const ctrl = require('../controllers/adminController');
const feedbackCtrl = require('../controllers/adminFeedbackController');
const dashboardCtrl = require('../controllers/adminDashboardController');
const analysisCtrl = require('../controllers/adminAnalysisController');

const router = express.Router();

router.post('/login', adminLoginLimiter, ctrl.login);
router.get('/users', requireAdminAuth, ctrl.listUsers);
router.get('/users/:id', requireAdminAuth, ctrl.getUser);
router.get('/users/:id/logs', requireAdminAuth, ctrl.getUserLogs);
router.post('/users', requireAdminAuth, ctrl.addUser);
router.put('/users/:id', requireAdminAuth, ctrl.updateUser);
router.delete('/users/:id', requireAdminAuth, ctrl.deleteUser);


router.get('/feedback', requireAdminAuth, feedbackCtrl.listFeedback);
router.put('/feedback/:id', requireAdminAuth, feedbackCtrl.updateFeedback);
router.delete('/feedback/:id', requireAdminAuth, feedbackCtrl.deleteFeedback);

router.get('/analyses', requireAdminAuth, analysisCtrl.listAnalyses);
router.get('/analyses/stats', requireAdminAuth, analysisCtrl.getAnalysisStats);

router.get('/dashboard', requireAdminAuth, dashboardCtrl.getStats);

router.get('/me', requireAdminAuth, ctrl.getMe);
router.put('/settings/password', requireAdminAuth, ctrl.changePassword);

module.exports = router;
