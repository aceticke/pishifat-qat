<template>
    <div class="row">
        <div class="col-md-12">
            <section class="card card-body">
                <select v-model="selectedCategory" class="form-control small" @change="loadContent($event)">
                    <option value="" disabled>
                        Select a category
                    </option>
                    <option
                        v-for="category in categories"
                        :key="category.id"
                        :value="category.value"
                        class="text-capitalize"
                    >
                        {{ category.content || category.value }}
                    </option>
                </select>
            </section>

            <section v-if="selectedCategory" class="card card-body">
                <h2>
                    <span :class="!isMode ? 'text-capitalize' : ''">
                        {{ getCategoryContent() }} - Questions
                    </span>

                    <button
                        class="btn btn-primary btn-sm"
                        data-toggle="modal"
                        data-target="#addQuestion"
                    >
                        Add question
                    </button>
                </h2>

                <data-table
                    v-if="questions.length"
                    :headers="['Question', 'Updated', '']"
                >
                    <tr v-for="question in questions" :key="question.id" :class="question.active ? 'border-active' : 'border-inactive'">
                        <td>
                            {{ question.content }}
                        </td>
                        <td>
                            {{ questionUpdated(question) }}
                        </td>
                        <td class="text-right">
                            <a
                                href="#"
                                data-toggle="modal"
                                data-target="#editQuestion"
                                @click="selectQuestion(question.id)"
                            >
                                <i class="fas fa-edit" />
                            </a>
                        </td>
                    </tr>
                </data-table>
            </section>
        </div>

        <add-question
            :category="selectedCategory"
        />

        <edit-question />

        <toast-messages />
    </div>
</template>

<script>
import manageTestModule from '../store/manageTest';
import ToastMessages from '../components/ToastMessages.vue';
import AddQuestion from '../components/rcTest/AddQuestion.vue';
import EditQuestion from '../components/rcTest/EditQuestion.vue';
import DataTable from '../components/DataTable.vue';
import { mapState } from 'vuex';

export default {
    name: 'ManageTestPage',
    components: {
        ToastMessages,
        AddQuestion,
        EditQuestion,
        DataTable,
    },
    data() {
        return {
            categories: [
                { value: 'codeOfConduct', content: 'Code Of Conduct' },
                { value: 'general' },
                { value: 'spread' },
                { value: 'metadata' },
                { value: 'timing' },
                { value: 'audio' },
                { value: 'videoBackground', content: 'Video/BG' },
                { value: 'skinning' },
                { value: 'storyboarding' },
                { value: 'osu', content: 'osu!' },
                { value: 'taiko', content: 'osu!taiko' },
                { value: 'catch', content: 'osu!catch' },
                { value: 'mania', content: 'osu!mania' },
                { value: 'bn', content: 'BN Rules' },
            ],
            selectedCategory: '',
        };
    },
    computed: {
        ...mapState('manageTest', [
            'questions',
        ]),
        /** @returns {boolean} */
        isMode () {
            const modes = ['osu', 'taiko', 'catch', 'mania'];

            return modes.includes(this.selectedCategory);
        },
    },
    beforeCreate () {
        if (!this.$store.hasModule('manageTest')) {
            this.$store.registerModule('manageTest', manageTestModule);
        }
    },
    methods: {
        async loadContent (e) {
            const data = await this.$http.executeGet('/manageTest/load/' + this.selectedCategory, e);

            if (data.questions && data.questions.length) {
                this.$store.commit('manageTest/setQuestions', data.questions);
            }
        },
        selectQuestion (id) {
            this.$store.commit('manageTest/setSelectedQuestionId', id);
        },
        getCategoryContent () {
            return this.categories.find(c => c.value === this.selectedCategory).content || this.selectedCategory;
        },
        questionUpdated (question) {
            let updated = new Date(question.updatedAt);

            for (const option of question.options) {
                let newUpdated = new Date(option.updatedAt);

                if (newUpdated > updated) {
                    updated = newUpdated;
                }
            }

            return updated.toString().slice(4,15);
        },
    },
};
</script>

<style>
.border-active {
    border-left: 5px solid var(--pass);
}

.border-inactive {
    border-left: 5px solid var(--fail);
}
</style>
