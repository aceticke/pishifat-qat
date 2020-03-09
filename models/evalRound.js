const mongoose = require('mongoose');

const evalRoundSchema = new mongoose.Schema({
    bn: { type: 'ObjectId', ref: 'User', required: true },
    mode: { type: String, enum: ['osu', 'taiko', 'catch', 'mania'], required: true },
    evaluations: [{ type: 'ObjectId', ref: 'Evaluation' }],
    deadline: { type: Date , required: true },
    active: { type: Boolean, default: true },
    discussion: { type: Boolean, default: false },
    consensus: { type: String, enum: ['pass', 'extend', 'fail'] },
    feedback: { type: String },
    feedbackAuthor: { type: 'ObjectId', ref: 'User' },
    isLowActivity: { type: Boolean, default: false },
    cooldownDate: { type: Date },
    natEvaluators: [{ type: 'ObjectId', ref: 'User' }],
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

class EvalRoundService
{

    static findActiveEvaluations() {
        let minDate = new Date();
        minDate.setDate(minDate.getDate() + 14);

        return EvalRound
            .find({
                active: true,
                deadline: { $lte: minDate },
            })
            .populate([
                {
                    path: 'bn',
                    select: 'username osuId probation modes',
                },
                {
                    path: 'natEvaluators',
                    select: 'username osuId',
                },
                {
                    path: 'evaluations',
                    select: 'evaluator behaviorComment moddingComment vote',
                    populate: {
                        path: 'evaluator',
                        select: 'username osuId group isLeader',
                    },
                },
            ])
            .sort({ deadline: 1, consensus: 1, feedback: 1 });
    }

    static async deleteManyByUserId(userId) {
        let minDate = new Date();
        minDate.setDate(minDate.getDate() + 14);

        try {
            return await EvalRound.deleteMany({
                bn: userId,
                active: true,
                deadline: { $gte: minDate },
            });
        } catch (error) {
            return { error: 'Something went wrong!' };
        }
    }

}

evalRoundSchema.loadClass(EvalRoundService);
const EvalRound = mongoose.model('EvalRound', evalRoundSchema);

module.exports = EvalRound;
