<template>
    <div>
        <p>
            <b>
                Notes
            </b>
        </p>
        <div v-if="summaryNote" class="my-2">
            <b>User summary</b>
            <div class="ml-4 small text-secondary" v-html="$md.render(summaryNote.comment)" />
        </div>

        <div v-if="warningNote" class="my-2">
            <b>Latest warning/action - 
                {{ warningNote.updatedAt | toStandardDate }} -
                <user-link
                    :osu-id="warningNote.author.osuId"
                    :username="warningNote.author.username"
                />
            </b>
            <div class="ml-4 small text-secondary" v-html="$md.render(warningNote.comment)" />
        </div>

        <textarea
            v-model="comment"
            placeholder="user note..."
            class="form-control"
            rows="2"
        />

        <div class="row mt-1">
            <div class="col-sm-6">
                <button class="btn btn-primary btn-block btn-sm" @click="saveNote($event)">
                    Save new note
                </button>
            </div>
            <div class="col-sm-3">
                <button class="btn btn-danger btn-block btn-sm" @click="saveNote($event, 'warning')">
                    {{ warningNote ? 'Overwrite' : 'Save' }} warning
                </button>
            </div>
            <div class="col-sm-3">
                <button class="btn btn-danger btn-block btn-sm" @click="saveNote($event, 'summary')">
                    {{ summaryNote ? 'Overwrite' : 'Save' }} summary
                </button>
            </div>
        </div>

        <p class="mt-2">
            <b>Other notes</b>
        </p>
        <ul class="mt-2">
            <li v-if="!otherNotes" class="small">
                ...
            </li>
            <li v-else-if="!otherNotes.length" class="small">
                User has no notes
            </li>
            <li
                v-for="note in otherNotes"
                v-else
                :key="note.id"
                class="small"
            >
                <b>
                    {{ note.updatedAt | toStandardDate }} -
                    <user-link
                        :osu-id="note.author.osuId"
                        :username="note.author.username"
                    />
                </b>
                <a
                    href="#"
                    class="ml-1 text-danger"
                    data-toggle="tooltip"
                    data-placement="top"
                    title="delete note"
                    @click.prevent="hideNote(note.id);"
                >
                    &times;
                </a>
                <a
                    v-if="note.author.id == loggedInUser.id"
                    href="#"
                    data-toggle="tooltip"
                    data-placement="top"
                    title="edit note"
                    @click.prevent="editNoteId == note.id ? editNoteId = '' : editNoteId = note.id, editNoteComment = note.comment"
                >
                    <i class="fas fa-edit" />
                </a>

                <div v-if="note.id != editNoteId" class="text-secondary ml-2" v-html="$md.render(note.comment)" />
                <div v-else>
                    <textarea
                        v-model="editNoteComment"
                        placeholder="edit user note..."
                        class="form-control"
                        rows="2"
                    />

                    <button class="btn btn-primary btn-sm btn-block mt-1" @click="editNote($event)">
                        Edit note
                    </button>
                </div>
            </li>
        </ul>
    </div>
</template>

<script>
import { mapState, mapGetters } from 'vuex';
import UserLink from '../../UserLink.vue';

export default {
    name: 'Notes',
    components: {
        UserLink,
    },
    data() {
        return {
            notes: null,
            comment: '',
            editNoteId: '',
            editNoteComment: '',
        };
    },
    computed: {
        ...mapState([
            'loggedInUser',
        ]),
        ...mapGetters('users', [
            'selectedUser',
        ]),
        /** @returns {Array} */
        otherNotes() {
            if (this.notes) {
                return this.notes.filter(n => !n.isWarning && !n.isSummary);
            }

            return null;
        },
        /** @returns {Object} */
        warningNote() {
            if (this.notes) {
                return this.notes.find(n => n.isWarning);
            }

            return null;
        },
        /** @returns {Object} */
        summaryNote() {
            if (this.notes) {
                return this.notes.find(n => n.isSummary);
            }

            return null;
        },
    },
    watch: {
        async selectedUser() {
            this.notes = null;
            this.comment = '';
            this.editNoteId = '';
            await this.loadUserNotes();
        },
        async notes() {
            if (this.notes && this.notes.length && this.notes[0].user.id !== this.selectedUser.id) { // without this, wrong notes show if you visit /users -> click a user -> search an unlisted user. can't figure out why
                await this.loadUserNotes();
            }
        },
    },
    mounted() {
        this.loadUserNotes();
    },
    methods: {
        async loadUserNotes() {
            const notes = await this.$http.executeGet('/users/nat/loadUserNotes/' + this.selectedUser.id);

            if (notes) {
                this.notes = notes;
            }
        },
        async saveNote(e, type) {
            if (this.comment.length) {
                const isWarning = (type == 'warning');
                const isSummary = (type == 'summary');

                const data = await this.$http.executePost('/users/nat/saveNote/' + this.selectedUser.id, { comment: this.comment, isWarning, isSummary }, e);

                if (this.$http.isValid(data)) {
                    if (this.notes) {
                        this.notes.unshift(data.note);
                    }
                }
            }
        },
        async editNote(e) {
            if (this.editNoteComment.length) {
                const data = await this.$http.executePost('/users/nat/editNote/' + this.editNoteId, { comment: this.editNoteComment }, e);

                if (this.$http.isValid(data)) {
                    if (this.notes) {
                        const i = this.notes.findIndex(n => n.id == this.editNoteId);
                        this.notes[i] = data.note;
                        this.editNoteId = '';
                    }
                }
            }
        },
        async hideNote(noteId) {
            const result = confirm(`Are you sure?`);

            if (result) {
                await this.$http.executePost('/users/nat/hideNote/' + noteId, { userId: this.selectedUser.id });

                if (this.notes) {
                    const i = this.notes.findIndex(note => note.id == noteId);
                    this.notes.splice(i, 1);
                }
            }
        },
    },
};
</script>