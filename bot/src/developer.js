import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { config } from './config.js';

// Who made this, for admins with a question, a bug or an idea: a button that
// opens their Discord profile, where "Message" starts a DM.
export const DEVELOPER = {
    name: 'Paradox',
    username: 'joaosilvajs',
    profile: 'https://discord.com/users/169180385501118485',
    repo: 'https://github.com/joaopmsilva/RSDWServerAPI',
    issues: 'https://github.com/joaopmsilva/RSDWServerAPI/issues',
    coffee: 'https://ko-fi.com/paradoxjs',
};

export const contactButton = () => new ButtonBuilder().setURL(DEVELOPER.profile).setLabel('Message the developer').setEmoji('💬').setStyle(ButtonStyle.Link);

export function contactReply() {
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('💬 Contact the developer')
        .setDescription(
            [
                `Questions, bugs or ideas for the mod, the bot or the installer? Message **${DEVELOPER.name}** on Discord: press the button below and then **Message**, or add \`${DEVELOPER.username}\`.`,
                '',
                'It helps to say which version you run (`/admin update` shows it) and to attach the newest file in `data/crashes/` if it\'s about a crash.',
                '',
                `Bug reports and ideas are also welcome on [GitHub](${DEVELOPER.issues}).`,
            ].join('\n'),
        )
        .setFooter({ text: config.serverName });
    const buttons = new ActionRowBuilder().addComponents(
        contactButton(),
        new ButtonBuilder().setURL(DEVELOPER.issues).setLabel('GitHub issues').setStyle(ButtonStyle.Link),
        new ButtonBuilder().setURL(DEVELOPER.coffee).setLabel('Support me on Ko-fi').setEmoji('☕').setStyle(ButtonStyle.Link),
    );
    return { reply: { embeds: [embed], components: [buttons] } };
}
