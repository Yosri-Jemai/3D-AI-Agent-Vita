package com.unity6.vita.service;

import com.unity6.vita.dto.EvaluationDTO;
import com.unity6.vita.dto.ReponseDTO;
import com.unity6.vita.entity.Evaluation;
import com.unity6.vita.entity.Profile;
import com.unity6.vita.entity.Reponse;
import com.unity6.vita.repository.EvaluationRepository;
import com.unity6.vita.repository.ReponseRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class EvaluationService {

    private final EvaluationRepository evaluationRepository;
    private final ReponseRepository reponseRepository;
    private final ProfileService profileService;

    public EvaluationDTO toDTO(Evaluation evaluation) {
        return EvaluationDTO.builder()
                .id(evaluation.getId())
                .profileId(evaluation.getProfile().getId())
                .profileName(evaluation.getProfile().getFullName())
                .score(evaluation.getScore())
                .feedback(evaluation.getFeedback())
                .date(evaluation.getDate())
                .build();
    }

    public ReponseDTO toReponseDTO(Reponse reponse) {
        return ReponseDTO.builder()
                .id(reponse.getId())
                .profileId(reponse.getProfile().getId())
                .evaluationId(reponse.getEvaluation().getId())
                .reponse(reponse.getReponse())
                .correcte(reponse.getCorrecte())
                .build();
    }

    @Transactional
    public EvaluationDTO createEvaluation(Long profileId) {
        Profile profile = profileService.getProfileById(profileId);

        Evaluation evaluation = Evaluation.builder()
                .profile(profile)
                .score(0f)
                .build();

        Evaluation saved = evaluationRepository.save(evaluation);
        return toDTO(saved);
    }

    @Transactional
    public ReponseDTO saveReponse(Long evaluationId, Long profileId, ReponseDTO reponseDTO) {
        Evaluation evaluation = evaluationRepository.findById(evaluationId)
                .orElseThrow(() -> new RuntimeException("Evaluation not found"));

        Profile profile = profileService.getProfileById(profileId);

        Reponse reponse = Reponse.builder()
                .evaluation(evaluation)
                .profile(profile)
                .reponse(reponseDTO.getReponse())
                .correcte(reponseDTO.getCorrecte())
                .build();

        Reponse saved = reponseRepository.save(reponse);

        // Recalculer le score de l'évaluation
        updateEvaluationScore(evaluation);

        return toReponseDTO(saved);
    }

    private void updateEvaluationScore(Evaluation evaluation) {
        List<Reponse> reponses = reponseRepository.findByEvaluation(evaluation);
        if (!reponses.isEmpty()) {
            long correctCount = reponses.stream().filter(Reponse::getCorrecte).count();
            float score = (correctCount * 100.0f) / reponses.size();
            evaluation.setScore(score);
            evaluationRepository.save(evaluation);
        }
    }

    @Transactional
    public EvaluationDTO finalizeEvaluation(Long evaluationId, String feedback) {
        Evaluation evaluation = evaluationRepository.findById(evaluationId)
                .orElseThrow(() -> new RuntimeException("Evaluation not found"));

        evaluation.setFeedback(feedback);

        Evaluation saved = evaluationRepository.save(evaluation);
        return toDTO(saved);
    }

    public List<EvaluationDTO> getProfileEvaluations(Long profileId) {
        Profile profile = profileService.getProfileById(profileId);
        return evaluationRepository.findByProfileOrderByDateDesc(profile)
                .stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
    }
}