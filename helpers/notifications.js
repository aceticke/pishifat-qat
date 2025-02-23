const cron = require('node-cron');
const moment = require('moment');
const discord = require('./discord');
const osuv1 = require('./osuv1');
const osu = require('./osu');
const scrap = require('./scrap');
const osuBot = require('./osuBot');
const util = require('./util');
const AppEvaluation = require('../models/evaluations/appEvaluation');
const Evaluation = require('../models/evaluations/evaluation');
const BnEvaluation = require('../models/evaluations/bnEvaluation');
const Veto = require('../models/veto');
const BnFinderMatch = require('../models/bnFinderMatch');
const User = require('../models/user');
const BeatmapReport = require('../models/beatmapReport');
const Discussion = require('../models/discussion');
const Report = require('../models/report');
const Logger = require('../models/log');
const Settings = require('../models/settings');
const { user } = require('../models/evaluations/base');
const ResignationEvaluation = require('../models/evaluations/resignationEvaluation');

const defaultPopulate = [
    { path: 'user', select: 'username osuId modesInfo' },
    { path: 'natEvaluators', select: 'username osuId discordId isBnEvaluator' },
    { path: 'bnEvaluators', select: 'username osuId discordId isBnEvaluator' },
    {
        path: 'reviews',
        select: 'evaluator',
        populate: {
            path: 'evaluator',
            select: 'username osuId groups discordId isBnEvaluator',
        },
    },
];

const defaultReportPopulate = [
    { path: 'culprit', select: 'username osuId modesInfo' },
];

/**
 * @param {Array} reviews
 * @param {Array} natEvaluators
 * @param {Boolean} discussion
 * @returns {Array} discord IDs for relevant NAT
 */
function findNatEvaluatorHighlights(reviews, natEvaluators, discussion) {
    let discordIds = [];

    if (discussion) {
        for (const review of reviews) {
            if (review.evaluator.groups.includes('nat') && review.evaluator.isBnEvaluator) {
                discordIds.push(review.evaluator.discordId);
            }
        }
    } else {
        const evaluatorIds = reviews.map(r => r.evaluator.id);

        for (const user of natEvaluators) {
            if (!evaluatorIds.includes(user.id) && user.isBnEvaluator) {
                discordIds.push(user.discordId);
            }
        }
    }

    return discordIds;
}

/**
 * @param {Array} reviews
 * @param {Array} evaluators
 * @param {Boolean} discussion
 * @returns {string} text for webhook
 */
function findNatEvaluatorStatuses(reviews, evaluators, discussion) {
    let text = '';

    if (!discussion) {
        const evaluatorIds = reviews.map(r => r.evaluator.id);

        for (const user of evaluators) {
            if (evaluatorIds.includes(user.id)) {
                text += `\n✅ `;
            } else {
                text += `\n❌ `;
            }

            text += `[${user.username}](https://osu.ppy.sh/users/${user.osuId})`;
        }
    }

    return text;
}

/**
 * @param {Boolean} discussion
 * @param {string} consensus
 * @param {string} feedback
 * @returns {string} text for webhook
 */
function findMissingContent(discussion, consensus, feedback) {
    let text = '\n**Next step:** ';

    if (!discussion) {
        text += `get more evaluations`;
    } else if (!consensus) {
        text += `decide consensus`;
    } else if (!feedback) {
        text += `write feedback`;
    } else {
        text += `send PM`;
    }

    return text;
}

/**
 * @param {Date} deadline
 * @returns {number} text for webhook
 */
function findDaysAgo(deadline) {
    const today = new Date();
    const contacted = new Date(deadline);
    const days = Math.round((today.getTime() - contacted.getTime()) / (1000 * 60 * 60 * 24));

    return days;
}

const notifyDeadlines = cron.schedule('0 17 * * *', async () => {
    // establish dates for reference
    const date = new Date();
    const nearDeadline = new Date();
    nearDeadline.setDate(nearDeadline.getDate() + 1);
    const startRange = new Date();
    startRange.setDate(startRange.getDate() + 6);
    const endRange = new Date();
    endRange.setDate(endRange.getDate() + 7);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // find active events
    let [activeApps, activeRounds, activeVetoes] = await Promise.all([
        AppEvaluation
            .find({
                active: true,
                test: { $exists: true },
            })
            .populate(defaultPopulate),

        Evaluation
            .find({ active: true })
            .populate(defaultPopulate),

        Veto.find({ status: 'wip' }),
        Report
            .find({ isActive: true, createdAt: { $lte: sevenDaysAgo } })
            .populate(defaultReportPopulate),
    ]);

    // find and post webhook for vetoes
    for (let i = 0; i < activeVetoes.length; i++) {
        const veto = activeVetoes[i];
        let description = `Veto mediation for [**${veto.beatmapTitle}**](http://bn.mappersguild.com/vetoes?id=${veto.id}) `;

        if (date > veto.deadline) {
            description += 'is overdue!';
        } else if (veto.deadline < nearDeadline) {
            description += 'is due in less than 24 hours!';
        }

        if (date > veto.deadline || veto.deadline < nearDeadline) {
            await discord.webhookPost(
                [{
                    description,
                    color: discord.webhookColors.red,
                }],
                veto.mode
            );
            await util.sleep(500);
        }
    }

    // find and post webhook for BN applications
    for (let i = 0; i < activeApps.length; i++) {
        const app = activeApps[i];
        const deadline = app.deadline;

        let description = `[**${app.user.username}**'s BN app](http://bn.mappersguild.com/appeval?id=${app.id}) `;
        let generateWebhook = true;
        let discordIds = [];
        let color;
        let evaluators = await Settings.getModeHasTrialNat(app.mode) ? app.natEvaluators.concat(app.bnEvaluators) : app.natEvaluators;

        if (date > deadline) {
            discordIds = findNatEvaluatorHighlights(app.reviews, evaluators, app.discussion);
            const days = findDaysAgo(app.createdAt);

            description += `was due ${days == 0 ? 'today!' : days == 1 ? days + ' day ago!' : days + ' days ago!'}`;
            color = discord.webhookColors.red;
        } else if (deadline < nearDeadline) {
            description += 'is due in less than 24 hours!';
            color = discord.webhookColors.lightRed;
        } else {
            generateWebhook = false;
        }

        if (generateWebhook) {
            description += findNatEvaluatorStatuses(app.reviews, evaluators, app.discussion);
            description += findMissingContent(app.discussion, app.consensus, app.feedback);

            await discord.webhookPost(
                [{
                    description,
                    color,
                }],
                app.mode
            );
            await util.sleep(500);

            await discord.userHighlightWebhookPost(app.mode, discordIds);
            await util.sleep(500);
        }
    }

    // find and post webhook for current BN evals
    for (let i = 0; i < activeRounds.length; i++) {
        const round = activeRounds[i];

        let description = `[**${round.user.username}**'s ${round.isResignation ? 'resignation' : 'current BN eval'}](http://bn.mappersguild.com/bneval?id=${round.id}) `;
        let natList = '';
        let trialNatList = '';
        let generateWebhook = true;
        let discordIds = [];
        let color;
        let evaluators = await Settings.getModeHasTrialNat(round.mode) ? round.natEvaluators.concat(round.bnEvaluators) : round.natEvaluators;

        if (round.deadline < endRange && (!round.natEvaluators || !round.natEvaluators.length)) {
            round.natEvaluators = await User.getAssignedNat(round.mode);
            await round.populate(defaultPopulate).execPopulate();
            const days = util.findDaysBetweenDates(new Date(), new Date(round.deadline));

            const assignments = [];

            for (const user of round.natEvaluators) {
                assignments.push({
                    date: new Date(),
                    user: user._id,
                    daysOverdue: days,
                });
            }

            round.natEvaluatorHistory = assignments;

            await round.save();

            natList = round.natEvaluators.map(u => u.username).join(', ');

            if (await Settings.getModeHasTrialNat(round.mode)) {
                if (!round.bnEvaluators || !round.bnEvaluators.length) {
                    round.bnEvaluators = await User.getAssignedTrialNat(round.mode, [round.user.osuId], (await Settings.getModeEvaluationsRequired(round.mode) - 1));
                    await round.populate(defaultPopulate).execPopulate();
                    await round.save();
                }

                trialNatList = round.bnEvaluators.map(u => u.username).join(', ');
            }
        }

        if (round.discussion) { // current BN evals in groups have 7 extra days
            const tempDate = new Date(round.deadline);
            tempDate.setDate(tempDate.getDate() + 7);
            round.deadline = tempDate;
        }

        if (date > round.deadline) {
            discordIds = findNatEvaluatorHighlights(round.reviews, evaluators, round.discussion);
            const days = findDaysAgo(round.deadline);

            description += `was due ${days == 0 ? 'today!' : days == 1 ? days + ' day ago!' : days + ' days ago!'}`;
            color = discord.webhookColors.red;
        } else if (round.deadline < nearDeadline) {
            description += 'is due in less than 24 hours!';
            color = discord.webhookColors.lightRed;
        } else if (round.deadline > startRange && round.deadline < endRange) {
            description += 'is due in 1 week!';
            color = discord.webhookColors.pink;
        } else {
            generateWebhook = false;
        }

        if (generateWebhook && !natList.length) {
            //evaluators = round.natEvaluators.concat(round.bnEvaluators);

            description += findNatEvaluatorStatuses(round.reviews, evaluators, round.discussion);
            description += findMissingContent(round.discussion, round.consensus, round.feedback);
            await discord.webhookPost(
                [{
                    description,
                    color,
                }],
                round.mode
            );
            await util.sleep(500);

            await discord.userHighlightWebhookPost(round.mode, discordIds);
            await util.sleep(500);
        } else if (generateWebhook && natList.length) {
            let fields = [
                {
                    name: 'Assigned NAT',
                    value: natList,
                },
            ];

            if (trialNatList.length) {
                fields.push({
                    name: 'Assigned BN',
                    value: trialNatList,
                });
            }

            await discord.webhookPost(
                [{
                    description,
                    color,
                    fields,
                }],
                round.mode
            );
            await util.sleep(500);
        }
    }
}, {
    scheduled: false,
});

const closeContentReviews = cron.schedule('0 9 * * *', async () => {
    const twoDaysAgo = new Date();
    const threeDaysAgo = new Date();
    const sevenDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 2);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const discussionPopulate = [
        {
            path: 'mediations',
            populate: {
                path: 'mediator',
                select: 'username osuId groups',
            },
        },
        { path: 'creator' },
    ];

    const activeContentReviews = await Discussion
        .find({ isContentReview: true, isActive: true })
        .populate(discussionPopulate);

    for (const discussion of activeContentReviews) {
        const sevenDaysOld = discussion.createdAt < sevenDaysAgo;
        const threeDaysOld = discussion.createdAt < threeDaysAgo;
        const inactive = discussion.updatedAt < twoDaysAgo;

        if (sevenDaysOld || (threeDaysOld && inactive)) {
            await Discussion.findByIdAndUpdate(discussion.id, { isActive: false });

            Logger.generate(
                null,
                'Concluded vote for a discussion',
                'discussionVote',
                discussion._id
            );

            const messages = await discord.contentCaseWebhookPost(discussion);
            await osuBot.sendMessages(discussion.creator.osuId, messages);
        }
    }
}, {
    scheduled: false,
});

const notifyBeatmapReports = cron.schedule('0 * * * *', async () => {
    const response = await osu.getClientCredentialsGrant();
    const token = response.access_token;

    // find pending discussion posts
    const parentDiscussions = await osu.getDiscussions(token, '?beatmapset_status=qualified&limit=50&message_types%5B%5D=suggestion&message_types%5B%5D=problem&only_unresolved=on');
    const discussions = parentDiscussions.discussions;

    // find database's discussion posts
    const date = new Date();
    date.setDate(date.getDate() - 10); // used to be 7, but backlog in qualified maps feed caused duplicate reports
    let beatmapReports = await BeatmapReport.find({ createdAt: { $gte: date } });
    await util.sleep(500);

    // create array of reported beatmapsetIds
    const beatmapsetIds = beatmapReports.map(r => r.beatmapsetId);

    for (const discussion of discussions) {
        let messageType = discussion.message_type;
        let discussionMessage = discussion.starting_post.message;
        let userId = discussion.user_id;

        /* NO RE-OPENED POSTS FOR NOW

        // find last reopen if it exists
        const parentPosts = await osu.getDiscussions(token, `/posts?beatmapset_discussion_id=${discussion.id}`);
        const posts = parentPosts.posts;
        await util.sleep(500);

        const postReported = await BeatmapReport.findOne({
            postId: discussion.id,
        });

        // replace discussion details with reopen
        if (postReported && posts[0] && posts[0].id !== discussion.starting_post.id) {
            messageType = `reopen ${messageType}`;
            discussionMessage = posts[0].message;
            userId = posts[0].user_id;
        }

        NO RE-OPENED POSTS FOR NOW */

        // determine which posts haven't been sent to #report-feed
        let createWebhook;

        if (!beatmapsetIds.includes(discussion.beatmapset_id)) {
            createWebhook = true;
        } else {
            let alreadyReported = await BeatmapReport.findOne({
                createdAt: { $gte: date },
                beatmapsetId: discussion.beatmapset_id,
                reporterUserId: userId,
            });

            if (!alreadyReported) {
                createWebhook = true;
            }
        }

        if (createWebhook) {
            // don't let the same map repeat in hourly cycle
            beatmapsetIds.push(discussion.beatmapset_id);

            // create event in db
            await BeatmapReport.create({
                beatmapsetId: discussion.beatmapset_id,
                postId: discussion.id,
                reporterUserId: userId,
            });

            // get user data
            const userInfo = await osuv1.getUserInfoV1(userId);
            await util.sleep(500);

            const mongoUser = await User.findOne({ osuId: userId });

            // identify modes
            let modes = [];

            if (discussion.beatmap) {
                if (discussion.beatmap.mode == 'fruits') modes.push('catch');
                else modes.push(discussion.beatmap.mode);

            } else {
                let beatmapsetInfo = await osuv1.beatmapsetInfo(discussion.beatmapset_id, true);
                beatmapsetInfo.forEach(beatmap => {
                    switch (beatmap.mode) {
                        case '0':
                            if (!modes.includes('osu')) modes.push('osu');
                            break;
                        case '1':
                            if (!modes.includes('taiko')) modes.push('taiko');
                            break;
                        case '2':
                            if (!modes.includes('catch')) modes.push('catch');
                            break;
                        case '3':
                            if (!modes.includes('mania')) modes.push('mania');
                            break;
                    }
                });
            }

            // send webhook
            await discord.webhookPost(
                [{
                    author: {
                        name: userInfo.username,
                        icon_url: `https://a.ppy.sh/${userId}`,
                        url: `https://osu.ppy.sh/users/${userId}`,
                    },
                    description: `[**${discussion.beatmapset.artist} - ${discussion.beatmapset.title}**](https://osu.ppy.sh/beatmapsets/${discussion.beatmapset_id}/discussion/-/generalAll#/${discussion.id})\nMapped by [${discussion.beatmapset.creator}](https://osu.ppy.sh/users/${discussion.beatmapset.user_id}) [**${modes.join(', ')}**]`,
                    thumbnail: {
                        url: `https://b.ppy.sh/thumb/${discussion.beatmapset_id}.jpg`,
                    },
                    color: messageType.includes('problem') ? discord.webhookColors.red : mongoUser && mongoUser.isBnOrNat ? discord.webhookColors.orange : discord.webhookColors.lightOrange,
                    fields: [
                        {
                            name: messageType,
                            value: discussionMessage.length > 500 ? discussionMessage.slice(0, 500) + '... *(truncated)*' : discussionMessage,
                        },
                    ],
                }],
                'beatmapReport'
            );
            await util.sleep(500);

            // send highlights
            if (messageType.includes('problem') || (mongoUser && mongoUser.isBnOrNat)) {
                modes.forEach(mode => {
                    discord.highlightWebhookPost('', `${mode}BeatmapReport`);
                });
            }
        }
    }
}, {
    scheduled: false,
});

/**
 * Checks for bns with less than 6 mods (4 for mania) over the course of 90 days the first day of every month
 */
const lowActivityTask = cron.schedule('0 23 1 * *', async () => {
    const lowActivityFields90 = [];
    const lowActivityFields30 = [];
    const initialDate90 = moment().subtract(3, 'months').toDate();
    const initialDate30 = moment().subtract(1, 'months').toDate();

    const bns = await User.find({ groups: 'bn' });

    for (const bn of bns) {
        const joinedHistory = bn.history.filter(h => h.kind === 'joined');
        const date = joinedHistory[joinedHistory.length - 1].date;

        if (new Date(date) < initialDate90) {
            for (const mode of bn.modes) {
                if (await hasLowActivity(initialDate90, bn, mode, 3)) {
                    lowActivityFields90.push({
                        name: bn.username,
                        value: `${await scrap.findUniqueNominationsCount(initialDate90, new Date(), bn)}`,
                        inline: true,
                        mode,
                    });
                }
                if (await hasLowActivity(initialDate30, bn, mode, 1)) {
                    lowActivityFields30.push({
                        name: bn.username,
                        value: `${await scrap.findUniqueNominationsCount(initialDate30, new Date(), bn)}`,
                        inline: true,
                        mode,
                    });
                }
            }
        }
    }

    if (!lowActivityFields90.length) return;

    // i don't care how stupid this is. this is how it's being done.
    let formatField90 = { name: 'username', value: 'nominations within 3 months' };
    let formatField30 = { name: 'username', value: 'nominations within 1 month' };
    let osuFields90 = [];
    let taikoFields90 = [];
    let catchFields90 = [];
    let maniaFields90 = [];
    let osuFields30 = [];
    let taikoFields30 = [];
    let catchFields30 = [];
    let maniaFields30 = [];
    osuFields90.push(formatField90);
    taikoFields90.push(formatField90);
    catchFields90.push(formatField90);
    maniaFields90.push(formatField90);
    osuFields30.push(formatField30);
    taikoFields30.push(formatField30);
    catchFields30.push(formatField30);
    maniaFields30.push(formatField30);

    for (const field of lowActivityFields90) {
        switch (field.mode) {
            case 'osu':
                osuFields90.push(field);
                break;
            case 'taiko':
                taikoFields90.push(field);
                break;
            case 'catch':
                catchFields90.push(field);
                break;
            case 'mania':
                maniaFields90.push(field);
                break;
        }
    }

    for (const field of lowActivityFields30) {
        switch (field.mode) {
            case 'osu':
                osuFields30.push(field);
                break;
            case 'taiko':
                taikoFields30.push(field);
                break;
            case 'catch':
                catchFields30.push(field);
                break;
            case 'mania':
                maniaFields30.push(field);
                break;
        }
    }

    const modeFields = [osuFields90, taikoFields90, catchFields90, maniaFields90, osuFields30, taikoFields30, catchFields30, maniaFields30];
    const modes = ['osu', 'taiko', 'catch', 'mania', 'osu', 'taiko', 'catch', 'mania']; // this is where it gets really stupid and i am embarrassed

    for (let i = 0; i < modeFields.length; i++) {
        const modeField = modeFields[i];

        if (modeField.length > 1) { // only create webhook if there are users with low activity in mode
            await discord.webhookPost(
                [{
                    title: `Low Activity ${i >= 4 ? '(30 days)' : '(90 days)'}`,
                    description: `The following users have low activity from ${i >= 4 ? initialDate30.toISOString().slice(0, 10) : initialDate90.toISOString().slice(0, 10)} to today`,
                    color: discord.webhookColors.red,
                    fields: modeField,
                }],
                modes[i]
            );
        }

        await util.sleep(500);
    }
}, {
    scheduled: false,
});

/**
 * Marks BN Finder Matches as Expired if not pending/WIP/graveyard
 */
 const checkMatchBeatmapStatuses = cron.schedule('2 22 * * *', async () => {
    const response = await osu.getClientCredentialsGrant();
    const token = response.access_token;

    const matches = await BnFinderMatch
        .find({
            isMatch: { $exists: false },
            isExpired: { $ne: true },
        })
        .populate('beatmapset');

    for (const match of matches) {
        const beatmapsetInfo = await osu.getBeatmapsetInfo(token, match.beatmapset.osuId);
        await util.sleep(500);

        // 4 = loved, 3 = qualified, 2 = approved, 1 = ranked, 0 = pending, -1 = WIP, -2 = graveyard
        if (beatmapsetInfo.error || beatmapsetInfo.ranked > 0) {
            await BnFinderMatch.findByIdAndUpdate(match.id, { isExpired: true });
        }
    }
}, {
    scheduled: false,
});

/**
 * Check if any current BNs have no upcoming evaluations (basically ensuring the NAT don't make a mistake and forget about it)
 */
const checkBnEvaluationDeadlines = cron.schedule('3 22 * * *', async () => {
    const bns = await User.find({ groups: 'bn'} );
    for (const bn of bns) {
        for (const mode of bn.modesInfo) {
            const er = await BnEvaluation.findOne({ user: bn.id, mode: mode.mode, active: true });
            const resignation = await ResignationEvaluation.findOne({ user: bn.id, mode: mode.mode, active: true });
            if (!er && !resignation) {
                await discord.webhookPost(
                    [{
                        title: `missing BN evaluation for ${bn.username}`,
                        color: discord.webhookColors.red,
                        description: `https://bn.mappersguild.com/users?id=${bn.id}`,
                    }],
                    'dev'
                );
            }
        }
    }

}, {
    scheduled: false,
});

/**
 * Check if any ex-BNs or ex-NAT have incorrectly accruing tenures
 */
const checkTenureValidity = cron.schedule('40 4 4 * *', async () => {
    const response = await osu.getClientCredentialsGrant();
    const token = response.access_token;

    const users = await User.find({
        'history.0': { $exists: true },
    });

    for (const user of users) {
        const mapperInfo = await osu.getOtherUserInfo(token, user.osuId);

        if (mapperInfo && mapperInfo.groups) {
            const isBn = mapperInfo.groups.some(g => g.id == 28 || g.id == 32);
            const isNat = mapperInfo.groups.some(g => g.id == 7);
            
            const bnHistory = user.history.filter(h => h.group == 'bn');
            bnHistory.sort((a, b) => {
                if (new Date(a.date) > new Date(b.date)) return 1;
                if (new Date(a.date) < new Date(b.date)) return -1;
    
                return 0;
            });

            const natHistory = user.history.filter(h => h.group == 'nat');
            natHistory.sort((a, b) => {
                if (new Date(a.date) > new Date(b.date)) return 1;
                if (new Date(a.date) < new Date(b.date)) return -1;
    
                return 0;
            });

            const bnModes = [];
            const natModes = [];

            if (isBn) {
                for (const group of mapperInfo.groups) {
                    if (group.id == 28 || group.id == 32) {
                        for (const playmode of group.playmodes) {
                            if (playmode == 'fruits') {
                                bnModes.push('catch');
                            } else {
                                bnModes.push(playmode);
                            }
                        }
                    }
                }
            }

            if (isNat) {
                for (const group of mapperInfo.groups) {
                    if (group.id == 7) {
                        for (const playmode of group.playmodes) {
                            if (playmode == 'fruits') {
                                natModes.push('catch');
                            } else {
                                natModes.push(playmode);
                            }
                        }
                    }
                }
            }

            const modes = ['osu', 'taiko', 'catch', 'mania'];

            for (const mode of modes) {
                const modeBnHistory = bnHistory.filter(h => h.mode == mode);
                const modeNatHistory = natHistory.filter(h => h.mode == mode);

                const lastModeBnHistory = modeBnHistory.length ? modeBnHistory[modeBnHistory.length - 1] : null;
                const lastModeNatHistory = modeNatHistory.length ? modeNatHistory[modeNatHistory.length - 1] : null;

                let notify = false;

                if (lastModeBnHistory) {
                    if (lastModeBnHistory.kind == 'joined') {
                        if (!bnModes.includes(mode)) {
                            notify = true;
                        }
                    } else {
                        if (bnModes.includes(mode)) {
                            notify = true;
                        }
                    }
                }
                
                if (lastModeNatHistory) {
                    if (lastModeNatHistory.kind == 'joined') {
                        if (!natModes.includes(mode)) {
                            notify = true;
                        }
                    } else {
                        if (natModes.includes(mode)) {
                            notify = true;
                        }
                    }
                }

                if (!isBn && !isNat) {
                    if ((lastModeBnHistory && lastModeBnHistory.kind == 'joined') || lastModeNatHistory && lastModeNatHistory.kind == 'joined') {
                        notify = true;
                    }
                }

                if (notify) {
                    await discord.webhookPost(
                        [{
                            title: `${user.username} ${mode} history is sus`,
                            color: discord.webhookColors.red,
                            description: `https://bn.mappersguild.com/users?id=${user.id}`,
                        }],
                        'dev'
                    );
                }
                
            }
        }

        await util.sleep(500);
    }
}, {
    scheduled: false,
});

/**
 * @param {Date} initialDate
 * @param {object} bn
 * @param {string} mode
 * @param {number} months
 * @returns {Promise<boolean>} whether or not the user has 'low activity'
 */
async function hasLowActivity(initialDate, bn, mode, months) {
    const uniqueNominationsCount = await scrap.findUniqueNominationsCount(initialDate, new Date(), bn);

    if (
        (uniqueNominationsCount < (2 * months) && mode == 'mania') ||
        (uniqueNominationsCount < (3 * months) && mode != 'mania')
    ) {
        return true;
    }

    return false;
}

/**
 * Checks for bns with less than required nomination count daily
 */
const lowActivityPerUserTask = cron.schedule('22 22 * * *', async () => {
    const initialDate90 = moment().subtract(3, 'months').toDate();
    const initialDate30 = moment().subtract(1, 'months').toDate();

    const bns = await User.find({ groups: 'bn' });

    for (const bn of bns) {
        const joinedHistory = bn.history.filter(h => h.kind === 'joined');
        const date = joinedHistory[joinedHistory.length - 1].date;

        if (new Date(date) < initialDate90) {
            for (const mode of bn.modes) {
                if (await hasLowActivity(initialDate90, bn, mode, 3) && (!bn.lastMarkedAsLowActivity || new Date(bn.lastMarkedAsLowActivity) < initialDate30)) {
                    bn.lastMarkedAsLowActivity = new Date();
                    await bn.save();

                    let role;

                    switch (mode) {
                        case 'osu':
                            role = 'natEvaluatorOsu';
                            break;
                        case 'taiko':
                            role = 'natEvaluatorTaiko';
                            break;
                        case 'catch':
                            role = 'natEvaluatorCatch';
                            break;
                        case 'mania':
                            role = 'natEvaluatorMania';
                            break;
                    }

                    const text = `**${bn.username}** (<https://osu.ppy.sh/users/${bn.osuId}>) - ${await scrap.findUniqueNominationsCount(initialDate90, new Date(), bn)} nominations in 90 days!`;

                    await discord.roleHighlightWebhookPost(mode, [role], text);
                }
            }
        }
    }
}, {
    scheduled: false,
});

module.exports = { notifyDeadlines, notifyBeatmapReports, lowActivityTask, closeContentReviews, checkMatchBeatmapStatuses, checkBnEvaluationDeadlines, lowActivityPerUserTask, checkTenureValidity };
