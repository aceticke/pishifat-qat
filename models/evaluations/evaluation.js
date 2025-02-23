const mongoose = require('mongoose');
const baseSchema = require('./base');

const evaluationSchema = new mongoose.Schema({
    ...baseSchema,
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true }, discriminatorKey: 'kind' });

class EvaluationService extends mongoose.Model {

    static findActiveEvaluations(mongoId) {
        let minDate = new Date();
        minDate.setDate(minDate.getDate() + 7);

        return this
            .find({
                active: true,
                deadline: { $lte: minDate },
                user: { $ne: mongoId },
            })
            .populate([
                {
                    path: 'user',
                    select: 'username osuId modesInfo groups',
                },
                {
                    path: 'natEvaluators',
                    select: 'username osuId',
                },
                {
                    path: 'bnEvaluators',
                    select: 'username osuId',
                },
                {
                    path: 'reviews',
                    select: 'evaluator behaviorComment moddingComment vote',
                    populate: {
                        path: 'evaluator',
                        select: 'username osuId groups',
                    },
                },
            ])
            .sort({ deadline: 1, consensus: 1, feedback: 1 });
    }

    static findInactiveEvaluations() {
        let minDate = new Date();
        minDate.setDate(minDate.getDate() + 7);

        return this
            .find({
                active: true,
                deadline: { $gte: minDate },
            })
            .populate([
                {
                    path: 'user',
                    select: 'username osuId modesInfo groups',
                },
                {
                    path: 'natEvaluators',
                    select: 'username osuId',
                },
                {
                    path: 'bnEvaluators',
                    select: 'username osuId',
                },
                {
                    path: 'reviews',
                    select: 'evaluator behaviorComment moddingComment vote',
                    populate: {
                        path: 'evaluator',
                        select: 'username osuId groups',
                    },
                },
            ])
            .sort({ deadline: 1, consensus: 1, feedback: 1 });
    }

    static deleteUserActiveEvaluations(userId) {
        let minDate = new Date();
        minDate.setDate(minDate.getDate() + 7);

        return this.deleteMany({
            user: userId,
            active: true,
            deadline: { $gte: minDate },
        });
    }

}

evaluationSchema.loadClass(EvaluationService);
/**
 * @type {import('../interfaces/evaluations').IEvaluationModel}
 */
const Evaluation = mongoose.model('Evaluation', evaluationSchema);

module.exports = Evaluation;
